/**
 * dsh-gitdeck — 浏览器半边的离线装载测试。
 *
 * 不开浏览器，也不打包：造一个最小的 window.__ModuleLoader__ / React / document，
 * 让 lib/ui/index.js 真正执行一遍——工厂函数跑起来、apply 挂上两个 slot、
 * 再把按钮和面板各渲染一次，看有没有拼错的名字或漏掉的引用。
 *
 *   node tests/client.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'lib', 'ui', 'index.js'), 'utf8')

// ── 最小 React 替身：只记录，不渲染 ──────────────────────────────────────
const rendered = []
const React = {
  createElement(type, props, ...children) {
    const node = { type, props: props ?? {}, children }
    rendered.push(node)
    return node
  },
  useState(initial) {
    return [typeof initial === 'function' ? initial() : initial, () => {}]
  },
  useEffect() {},
  useCallback(fn) {
    return fn
  },
  useMemo(fn) {
    return fn()
  },
  useRef(value) {
    return { current: value ?? null }
  },
  useSyncExternalStore(_subscribe, getSnapshot) {
    return getSnapshot()
  },
}

// ── 最小浏览器环境 ───────────────────────────────────────────────────────
const styles = []
globalThis.document = {
  createElement(tag) {
    return { tag, setAttribute() {}, textContent: '', parentNode: null, dataset: {} }
  },
  head: {
    appendChild(node) {
      styles.push(node)
      node.parentNode = this
    },
    removeChild() {},
  },
  querySelector() {
    return null
  },
}

globalThis.window = {
  localStorage: {
    _data: new Map(),
    getItem(key) {
      return this._data.has(key) ? this._data.get(key) : null
    },
    setItem(key, value) {
      this._data.set(key, String(value))
    },
  },
  open() {},
  __ModuleLoader__: {
    load({ id, factory }) {
      captured = { id, factory }
    },
  },
}

globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ connected: false }) })

let captured = null
// 模块体本身就是给浏览器跑的脚本，塞进当前全局环境直接执行一遍
eval(source)

assert.ok(captured !== null, '模块应当调用 __ModuleLoader__.load')
assert.equal(captured.id, 'dsh-gitdeck')

const mod = captured.factory((name) => {
  if (name === 'react') return React
  throw new Error(`未预期的依赖：${name}`)
})

assert.equal(mod.name, 'dsh-gitdeck')
assert.deepEqual(mod.inject, ['slots'])

// ── apply：两个 slot + 一份样式 ───────────────────────────────────────────
const registrations = []
const ctx = {
  effect(setup) {
    return setup()
  },
  slots: {
    inject(name, fn) {
      assert.equal(typeof name, 'string')
      return fn()
    },
    register(options, component) {
      registrations.push({ options, component })
      return () => {}
    },
  },
}

mod.apply(ctx)
assert.equal(registrations.length, 2, '应当注册两个 slot')
assert.equal(registrations[0].options.name, 'conversation.input.left')
assert.equal(registrations[1].options.name, 'conversation.input.overlay')
assert.ok(styles.length >= 1, '应当插入样式表')

// ── 渲染：按钮与面板各跑一次 ─────────────────────────────────────────────
// 注册的函数只是包一层 createElement，真正的组件在被返回的节点上，
// 这里手动调用一次，等于让 React 渲染它。
const render = (node) => (typeof node?.type === 'function' ? node.type(node.props) : node)

const trigger = registrations[0].component({ sessionId: 's-1' })
assert.ok(trigger !== undefined && trigger !== null, '按钮应当渲染出节点')
const triggerNode = render(trigger)
assert.equal(triggerNode?.type, 'button', '按钮应当渲染成 button')

const panel = registrations[1].component({ sessionId: 's-1' })
assert.equal(render(panel), null, '面板默认收起（overlay 只在该会话打开时渲染）')

console.log('client 装载测试全过：')
console.log('  ✓ 模块导出 name / inject / apply')
console.log('  ✓ 注册 conversation.input.left + conversation.input.overlay')
console.log(`  ✓ 样式表 ${styles.length} 份`)
console.log(`  ✓ 按钮渲染出 ${rendered.length} 个节点，面板默认收起`)
