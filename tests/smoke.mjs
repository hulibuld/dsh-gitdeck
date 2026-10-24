/**
 * dsh-gitdeck — 冒烟测试。
 *
 * 不连网、不碰真实凭据：把 DSH_HOME 指到临时目录，用桩 ctx 走一遍装配流程，
 * 再逐项验证路径解析、只读拦截和接口错误分支。跑法：
 *
 *   node tests/smoke.mjs
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'

const home = mkdtempSync(join(tmpdir(), 'gitdeck-test-'))
process.env.DSH_HOME = home

const { apply, name } = await import('../lib/host.js')
const { resolveUrl } = await import('../lib/github.js')
const { handleRequest } = await import('../lib/routes.js')
const { createTool } = await import('../lib/tool.js')
const store = await import('../lib/store.js')

let passed = 0
const check = (label, fn) => {
  fn()
  passed += 1
  console.log(`  ✓ ${label}`)
}

// ── 1. 装配：两个注入面都挂上了 ──────────────────────────────────────────
console.log('装配')
{
  const calls = { routes: [], tools: [], prompts: [] }
  const ctx = {
    inject(deps, fn) {
      if (deps.includes('webServer')) {
        fn({
          webServer: {
            register(options) {
              calls.routes.push(options)
              return () => {}
            },
          },
          effect: (dispose) => dispose,
        })
        return
      }
      fn({
        tools: {
          register(tool) {
            calls.tools.push(tool)
          },
        },
        systemPrompt: {
          section(section) {
            calls.prompts.push(section)
          },
        },
      })
    },
  }

  check('插件名是 dsh-gitdeck', () => assert.equal(name, 'dsh-gitdeck'))
  apply(ctx, {})
  check('注册了一个 /dsh-gitdeck 前缀路由', () => {
    assert.equal(calls.routes.length, 1)
    assert.equal(calls.routes[0].path, '/dsh-gitdeck')
    assert.equal(calls.routes[0].kind, 'prefix')
  })
  check('注册了 github_api 工具', () => {
    assert.equal(calls.tools.length, 1)
    assert.equal(calls.tools[0].name, 'github_api')
  })
  check('注入了一段提示词', () => assert.equal(calls.prompts.length, 1))
}

// ── 2. 路径解析：查询串、中文、越界 ──────────────────────────────────────
console.log('路径解析')
check('允许查询串（保留 + 作空格的惯例）', () => {
  const url = resolveUrl('/search/issues?q=repo:a/b+is:open')
  assert.equal(url, 'https://api.github.com/search/issues?q=repo%3Aa%2Fb+is%3Aopen')
})
check('中文路径按段编码', () => {
  const url = resolveUrl('/repos/o/r/contents/测试资料/README.md')
  assert.ok(url.endsWith('/contents/%E6%B5%8B%E8%AF%95%E8%B5%84%E6%96%99/README.md'))
})
check('拒绝 .. 越界', () => assert.equal(resolveUrl('/repos/../../etc/passwd'), null))
check('拒绝不以 / 开头', () => assert.equal(resolveUrl('repos/a/b'), null))
check('拒绝反斜杠', () => assert.equal(resolveUrl('/a\\b'), null))
check('拒绝空路径', () => assert.equal(resolveUrl(''), null))

// ── 3. 接口：未连接时的状态与错误 ────────────────────────────────────────
console.log('接口')
function fakeRequest(method, url, body, headers = {}) {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
  return Object.assign(
    (async function* () {
      for (const chunk of chunks) yield chunk
    })(),
    { method, url, headers },
  )
}
async function fakeResponse() {
  const state = { status: 0, headers: {}, body: '' }
  return {
    state,
    writeHead(status, headers) {
      state.status = status
      state.headers = headers ?? {}
    },
    end(text) {
      state.body = text ?? ''
    },
  }
}

const statusResponse = await fakeResponse()
await handleRequest(fakeRequest('GET', '/dsh-gitdeck/status', undefined, { host: 'localhost:1' }), statusResponse)
check('未连接时 status 返回 connected=false', () => {
  assert.equal(statusResponse.state.status, 200)
  const payload = JSON.parse(statusResponse.state.body)
  assert.equal(payload.connected, false)
})

const notFound = await fakeResponse()
await handleRequest(fakeRequest('GET', '/dsh-gitdeck/nope', undefined, { host: 'localhost:1' }), notFound)
check('未知子路径 404', () => assert.equal(notFound.state.status, 404))

const badJson = await fakeResponse()
await handleRequest(fakeRequest('POST', '/dsh-gitdeck/pat', undefined, { host: 'localhost:1', origin: 'http://localhost:1' }), badJson)
check('缺 token 的 POST 返回 4xx', () => assert.ok(badJson.state.status >= 400 && badJson.state.status < 500))

// ── 4. 工具：只读拦截 + 未连接报错 ───────────────────────────────────────
console.log('工具')
{
  const tool = createTool({})
  // DSH 的工具约定是「返回结果对象」而不是抛异常，错误也走返回值。
  const write = () => tool.execute({ method: 'POST', path: '/user/repos', body: { name: 'x' } })

  check('未连接时状态是断开', () => {
    assert.equal(store.publicStatus().connected, false)
  })

  store.writeSettings({ readOnly: true })
  const blocked = await write()
  check('只读模式拦下写操作（403）', () => {
    assert.equal(blocked.ok, false)
    assert.equal(blocked.status, 403)
    assert.match(blocked.error, /只读/)
  })

  store.writeSettings({ readOnly: false })
  const noToken = await write()
  check('恢复可写后因未连接报 401', () => {
    assert.equal(noToken.ok, false)
    assert.equal(noToken.status, 401)
    assert.match(noToken.error, /连接/)
  })

  const badMethod = await tool.execute({ method: 'HEAD', path: '/user' })
  check('非法 method 被拒（400）', () => {
    assert.equal(badMethod.ok, false)
    assert.equal(badMethod.status, 400)
  })
}

rmSync(home, { recursive: true, force: true })
console.log(`\n全过：${passed} 项`)
