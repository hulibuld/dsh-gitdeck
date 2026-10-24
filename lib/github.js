/**
 * dsh-gitdeck — GitHub 接口层。
 *
 * 只做三件事：把路径拼成合法 URL、带令牌发请求、把 GitHub 的错误翻译成
 * 人话。所有网络请求都走 net.js 的 dispatcher（系统代理 / 系统 CA 感知），
 * 令牌只出现在发往 api.github.com 的 Authorization 头里。
 */
import { dispatcherFor } from './net.js'

export const API_BASE = 'https://api.github.com'
export const DEVICE_CODE_URL = 'https://github.com/login/device/code'
export const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token'
export const USER_AGENT = 'dsh-gitdeck'
export const DEFAULT_SCOPES = 'repo gist read:org workflow'

/** 插件当前配置（代理设置），由 host.js 在 apply 时注入。 */
let runtimeConfig = {}

export function configure(config) {
  runtimeConfig = {
    ...(typeof config?.proxy === 'string' ? { proxy: config.proxy } : {}),
    ...(Array.isArray(config?.noProxy) ? { noProxy: config.noProxy } : {}),
  }
}

/** 带 dispatcher 的 fetch。 */
export async function ghFetch(url, init, timeoutMs = 30000) {
  const dispatcher = await dispatcherFor(new URL(url).hostname, runtimeConfig)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, {
      ...init,
      signal: init?.signal ?? controller.signal,
      ...(dispatcher !== undefined ? { dispatcher } : {}),
    })
  } finally {
    clearTimeout(timer)
  }
}

function decodeLoose(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

const encodeSegment = (segment) => encodeURIComponent(decodeLoose(segment))

// 查询串里的 `+` 按 URL 惯例表示空格，GitHub 搜索语法也这么用，所以保留原文；
// 其余字符照常百分号编码（空格会变成 %20，同样等价）。
const encodeQueryToken = (value) => encodeSegment(value).replace(/%2B/g, '+')

/**
 * 把 `/repos/o/r/pulls?state=all` 这样的路径变成完整 URL。
 *
 * 允许查询串；路径段里的非 ASCII 会被百分号编码（已经编码过的不重复编码）。
 * 仍然拒绝：不以 / 开头、含 `..`、含空白或反斜杠。
 * 不合法返回 null。
 */
export function resolveUrl(raw) {
  if (typeof raw !== 'string' || raw === '') return null
  const mark = raw.indexOf('?')
  const pathPart = mark === -1 ? raw : raw.slice(0, mark)
  const queryPart = mark === -1 ? '' : raw.slice(mark + 1)
  if (!pathPart.startsWith('/') || pathPart.includes('..') || /[\s\\]/.test(pathPart)) return null
  const encodedPath = pathPart.split('/').map(encodeSegment).join('/')
  if (queryPart === '') return `${API_BASE}${encodedPath}`
  const pairs = queryPart
    .split('&')
    .filter((pair) => pair !== '')
    .map((pair) => {
      const eq = pair.indexOf('=')
      if (eq === -1) return encodeQueryToken(pair)
      const key = encodeQueryToken(pair.slice(0, eq))
      const value = encodeQueryToken(pair.slice(eq + 1))
      return value === '' ? key : `${key}=${value}`
    })
  return `${API_BASE}${encodedPath}${pairs.length > 0 ? `?${pairs.join('&')}` : ''}`
}

export function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': USER_AGENT,
  }
}

function networkMessage(error) {
  // undici 把真实原因塞在 cause 里，一起吐出来才好排查。
  let reason = error instanceof Error ? error.message : String(error)
  const cause = error?.cause
  if (cause instanceof Error && cause.message !== reason) reason = `${reason}：${cause.message}`
  return reason
}

/**
 * 调一次 REST 接口。永远不抛：返回 { status, body?, message?, rateLimit? }。
 * status 0 表示没连上（网络/TLS）。
 */
export async function callApi({ token, method = 'GET', path, body, maxBodyChars = 60000, signal }) {
  const url = resolveUrl(path)
  if (url === null) {
    return { status: 400, message: `路径不合法：${path === '' ? '(空)' : path}。需以 / 开头，不能含 .. 或空白。` }
  }
  const headers = authHeaders(token)
  const init = { method, headers, signal }
  if (method !== 'GET' && method !== 'HEAD') {
    headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify(body ?? {})
  }
  let res
  try {
    res = await ghFetch(url, init)
  } catch (error) {
    return { status: 0, message: `连不上 GitHub：${networkMessage(error)}。检查一下代理设置。` }
  }
  const text = await res.text().catch(() => '')
  const rateLimit = `limit=${res.headers.get('x-ratelimit-limit') ?? '?'} remaining=${res.headers.get('x-ratelimit-remaining') ?? '?'}`
  const clipped = text.length > maxBodyChars ? `${text.slice(0, maxBodyChars)}\n…（已截断）` : text
  if (res.ok) return { status: res.status, body: clipped, rateLimit }
  let detail = ''
  try {
    detail = JSON.parse(text)?.message ?? ''
  } catch {
    detail = text.slice(0, 200)
  }
  return { status: res.status, body: clipped, rateLimit, message: explain(res.status, detail) }
}

function explain(status, detail) {
  if (status === 401) return `令牌无效或已失效（Bad credentials）：${detail || 'Bad credentials'}`
  if (status === 403) return `GitHub 拒绝了这次请求（多半是限额或权限不够）：${detail || 'API rate limit exceeded'}`
  if (status === 404) return `令牌能用，但这个对象访问不到：${detail || 'Not Found'}`
  if (status === 422) return `参数没通过校验：${detail || 'Unprocessable Entity'}`
  if (status >= 500) return `GitHub 那边出错了（HTTP ${status}）：${detail || '(无详情)'}，稍后重试`
  return `HTTP ${status}：${detail || '(无详情)'}`
}

/** 读账号；用来校验令牌、刷新状态。 */
export async function readUser(token) {
  let res
  try {
    res = await ghFetch(`${API_BASE}/user`, { headers: authHeaders(token) })
  } catch (error) {
    return { status: 0, message: `连不上 GitHub：${networkMessage(error)}` }
  }
  const text = await res.text().catch(() => '')
  if (res.ok) {
    try {
      return { status: res.status, user: JSON.parse(text) }
    } catch {
      return { status: res.status, message: 'GitHub 返回的内容看不懂，稍后重试' }
    }
  }
  let detail = ''
  try {
    detail = JSON.parse(text)?.message ?? ''
  } catch {
    detail = text.slice(0, 200)
  }
  return { status: res.status, message: explain(res.status, detail) }
}
