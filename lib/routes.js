/**
 * dsh-gitdeck — 浏览器半边的后端接口。
 *
 * 全部挂在 /dsh-gitdeck 前缀下，只监听本机 DSH web server。写操作要求同源
 * （Origin 的 host 必须等于 Host 头），避免别的网页偷偷调这个端口改状态。
 */
import {
  connectWithPat,
  disconnect,
  isClientId,
  isScopes,
  pollDeviceFlow,
  startDeviceFlow,
  verifyStoredToken,
} from './auth.js'
import {
  isReadOnly,
  publicStatus,
  recentCalls,
  writeSettings,
} from './store.js'

export const ROUTE_PREFIX = '/dsh-gitdeck'

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  response.end(body)
}

function sendText(response, status, text) {
  response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' })
  response.end(text)
}

async function readJson(request, limitBytes = 65536) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > limitBytes) throw new Error('请求体过大')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim() === '') return {}
  return JSON.parse(text)
}

function sameOrigin(request) {
  const origin = request.headers.origin
  if (origin === undefined || origin === 'null') return true
  const host = request.headers.host
  if (host === undefined) return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

const ROUTES = [
  {
    method: 'GET',
    subpath: '/status',
    mutation: false,
    handle: async () => publicStatus(),
  },
  {
    method: 'POST',
    subpath: '/verify',
    mutation: true,
    handle: async () => verifyStoredToken(),
  },
  {
    method: 'POST',
    subpath: '/device/start',
    mutation: true,
    handle: async (input) => {
      const clientId = typeof input.clientId === 'string' ? input.clientId.trim() : ''
      if (!isClientId(clientId)) {
        return {
          error:
            'Client ID 看着不对。GitHub OAuth App 是 20 位（早期是纯十六进制，现在的形如 Ov23li…），GitHub App 是 Iv1. 开头。去 Settings → Developer settings → OAuth Apps 复制完整的那串。',
        }
      }
      const scopes = typeof input.scopes === 'string' && input.scopes.trim() !== ''
        ? input.scopes.trim()
        : undefined
      if (scopes !== undefined && !isScopes(scopes)) return { error: 'scopes 写法不对（只允许小写字母、数字和 : , _ - 空格）' }
      return startDeviceFlow(clientId, scopes)
    },
  },
  {
    method: 'POST',
    subpath: '/device/poll',
    mutation: true,
    handle: async (input) => {
      const clientId = typeof input.clientId === 'string' ? input.clientId : ''
      const deviceCode = typeof input.deviceCode === 'string' ? input.deviceCode : ''
      if (clientId === '' || deviceCode === '') return { error: '缺少参数，重新开始连接' }
      return pollDeviceFlow(clientId, deviceCode)
    },
  },
  {
    method: 'POST',
    subpath: '/pat',
    mutation: true,
    handle: async (input) => {
      const raw = typeof input.token === 'string' ? input.token : ''
      if (raw.trim() === '') return { error: '先把 Token 粘进来' }
      return connectWithPat(raw)
    },
  },
  {
    method: 'POST',
    subpath: '/disconnect',
    mutation: true,
    handle: async () => disconnect(),
  },
  {
    method: 'GET',
    subpath: '/history',
    mutation: false,
    handle: async () => ({ calls: recentCalls() }),
  },
  {
    method: 'POST',
    subpath: '/settings',
    mutation: true,
    handle: async (input) => {
      const patch = {}
      if (typeof input.readOnly === 'boolean') patch.readOnly = input.readOnly
      const next = writeSettings(patch)
      return { readOnly: next.readOnly === true }
    },
  },
]

/** 路由分发。 */
export async function handleRequest(request, response) {
  let url
  try {
    url = new URL(request.url ?? '/', 'http://127.0.0.1')
  } catch {
    sendText(response, 400, 'bad request')
    return
  }
  const method = request.method ?? 'GET'
  const subpath = url.pathname.startsWith(ROUTE_PREFIX)
    ? url.pathname.slice(ROUTE_PREFIX.length) || '/'
    : null
  const route = subpath === null
    ? undefined
    : ROUTES.find((candidate) => candidate.method === method && candidate.subpath === subpath)
  if (route === undefined) {
    sendJson(response, 404, { error: 'not found' })
    return
  }
  if (route.mutation && !sameOrigin(request)) {
    sendJson(response, 403, { error: '跨域请求被拒绝' })
    return
  }
  try {
    const input = route.mutation ? await readJson(request) : {}
    const result = await route.handle(input)
    // 校验失败统一用 400：前端拿到的仍是 { error }，但状态码别撒谎。
    const bad = result !== null && typeof result === 'object' && typeof result.error === 'string'
    sendJson(response, bad ? 400 : 200, result)
  } catch (error) {
    sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) })
  }
}

export { isReadOnly }
