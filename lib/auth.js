/**
 * dsh-gitdeck — 授权流程。
 *
 * 两条路：
 *  - OAuth 设备流：用户自己有 OAuth App，填 Client ID，浏览器里输 8 位码；
 *  - 粘贴 PAT：fine-grained token，框选权限直接粘进来。
 *
 * 两条路最后都落到同一个凭据记录，区别只在 kind 字段。
 */
import {
  ACCESS_TOKEN_URL,
  DEVICE_CODE_URL,
  DEFAULT_SCOPES,
  ghFetch,
  readUser,
} from './github.js'
import { publicStatus, readAuth, rememberClientId, writeAuth } from './store.js'

// GitHub OAuth App 的 Client ID：老式 20 位十六进制、新式 20 位字母数字
// （形如 Ov23li…）；GitHub App 是 Iv1. + 16 位十六进制。
const CLIENT_ID_RE = /^(?:[0-9a-fA-F]{20}|[A-Za-z0-9]{20}|Iv1\.[0-9a-fA-F]{16})$/
const SCOPE_RE = /^[a-z0-9:,_\- ]*$/i

export function isClientId(value) {
  return CLIENT_ID_RE.test(value)
}

export function isScopes(value) {
  return value.length <= 200 && SCOPE_RE.test(value)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const form = (fields) => new URLSearchParams(fields).toString()

/** 起一个设备码。 */
export async function startDeviceFlow(clientId, scopes = DEFAULT_SCOPES) {
  let res
  try {
    res = await ghFetch(DEVICE_CODE_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'dsh-gitdeck',
      },
      body: form({ client_id: clientId, scope: scopes }),
    })
  } catch (error) {
    return { error: `连不上 github.com：${error instanceof Error ? error.message : String(error)}` }
  }
  const data = await res.json().catch(() => null)
  if (!res.ok || data === null || typeof data.device_code !== 'string') {
    return {
      error: data?.error_description || data?.message || `GitHub 不认这个 Client ID（HTTP ${res.status}）`,
    }
  }
  rememberClientId(clientId)
  return {
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    deviceCode: data.device_code,
    expiresIn: typeof data.expires_in === 'number' ? data.expires_in : 900,
    interval: Math.max(1, typeof data.interval === 'number' ? data.interval : 5),
  }
}

/** 轮询一次设备码状态。 */
export async function pollDeviceFlow(clientId, deviceCode) {
  let res
  try {
    res = await ghFetch(ACCESS_TOKEN_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'dsh-gitdeck',
      },
      body: form({
        client_id: clientId,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    })
  } catch (error) {
    return { status: 'error', message: `连不上 github.com：${error instanceof Error ? error.message : String(error)}` }
  }
  const data = await res.json().catch(() => null)
  if (data !== null && typeof data.access_token === 'string' && data.access_token !== '') {
    const me = await readUser(data.access_token)
    if (me.user === undefined) {
      return { status: 'error', message: me.message ?? '拿到令牌了，但读不到账号信息，再试一次' }
    }
    const user = me.user
    const scopes = typeof data.scope === 'string'
      ? data.scope.split(',').map((s) => s.trim()).filter(Boolean)
      : []
    const now = new Date().toISOString()
    writeAuth({
      kind: 'oauth',
      token: data.access_token,
      login: user.login,
      avatarUrl: user.avatar_url ?? null,
      displayName: user.name ?? null,
      scopes,
      connectedAt: now,
      lastVerifiedAt: now,
      clientId,
    })
    return {
      status: 'authorized',
      user: { login: user.login, avatarUrl: user.avatar_url ?? null, name: user.name ?? null, scopes },
    }
  }
  const code = data?.error ?? null
  if (code === 'authorization_pending') return { status: 'pending' }
  if (code === 'slow_down') return { status: 'pending', slowDown: true }
  if (code === 'expired_token') return { status: 'expired', message: '验证码过期了，重新开一次连接' }
  if (code === 'access_denied') return { status: 'denied', message: '你在 GitHub 上点了拒绝' }
  return { status: 'error', message: data?.error_description || data?.error || `GitHub 返回 HTTP ${res.status}` }
}

/** 用 PAT 连接（401 之外的可重试错误自动重试一次）。 */
export async function connectWithPat(rawToken) {
  let token = rawToken.trim()
  // 复制粘贴常把引号一起带进来。
  if (/^(["']).*\1$/.test(token)) token = token.slice(1, -1)
  if (token.length < 10 || token.length > 400) return { error: '这不像一个 Personal Access Token' }
  let last = null
  for (let attempt = 1; attempt <= 2; attempt++) {
    const me = await readUser(token)
    if (me.user !== undefined) {
      const now = new Date().toISOString()
      writeAuth({
        kind: 'pat',
        token,
        login: me.user.login,
        avatarUrl: me.user.avatar_url ?? null,
        displayName: me.user.name ?? null,
        scopes: [],
        connectedAt: now,
        lastVerifiedAt: now,
      })
      return { user: { login: me.user.login, avatarUrl: me.user.avatar_url ?? null, name: me.user.name ?? null } }
    }
    last = me
    if (attempt === 1 && (me.status === 0 || me.status >= 500 || me.status === 403)) {
      await sleep(800)
      continue
    }
    break
  }
  return { error: last?.message ?? '这个 Token 用不了' }
}

/**
 * 用一次 /user 复核存量令牌：
 *  - 200：刷新 lastVerifiedAt，标记 verified；
 *  - 401：令牌确实废了，清掉连接；
 *  - 其它（网络抖动、5xx）：保留令牌，只报 verified=false，不能因为断网就登出。
 */
export async function verifyStoredToken() {
  const auth = readAuth()
  if (auth === null || typeof auth.token !== 'string' || auth.token === '') {
    return { connected: false, lastVerifiedAt: null }
  }
  const me = await readUser(auth.token)
  if (me.user !== undefined) {
    writeAuth({ ...auth, lastVerifiedAt: new Date().toISOString() })
    return { ...publicStatus(), verified: true }
  }
  if (me.status === 401) {
    writeAuth(null)
    return { connected: false, lastVerifiedAt: null, invalidated: true, message: me.message }
  }
  return { ...publicStatus(), verified: false, message: me.message }
}

/** 断开：抹掉令牌，但记住 Client ID（它不是秘密，省得每次重填）。 */
export function disconnect() {
  const remembered = readAuth()?.clientId
  writeAuth(null)
  const kept = typeof remembered === 'string' && remembered !== '' ? remembered : null
  if (kept !== null) writeAuth({ clientId: kept })
  return { connected: false, clientId: kept }
}
