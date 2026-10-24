/**
 * dsh-gitdeck — 凭据与设置存储。
 *
 * 三条原则：
 *  1) 令牌只放在 DSH home 下，不放在插件包目录里 —— 包目录每次更新都会被
 *     包管理器整个替换掉，写在那里的令牌会跟着消失。
 *  2) 一个 home 只留一份连接，所有 profile 共用。
 *  3) 凭据位置可以用配置项 authFile 改写（多 profile 各自隔离时有用）。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const PLUGIN_ID = 'dsh-gitdeck'

/** DSH home：环境变量优先，否则 ~/.dsh */
export function dshHome() {
  const fromEnv = typeof process.env.DSH_HOME === 'string' ? process.env.DSH_HOME.trim() : ''
  return fromEnv !== '' ? fromEnv : join(homedir(), '.dsh')
}

/** 允许配置项 authFile 改写凭据位置。 */
export function resolveAuthPath(config) {
  const override = typeof config?.authFile === 'string' ? config.authFile.trim() : ''
  if (override !== '') return override
  return join(dshHome(), `.${PLUGIN_ID}`, 'auth.json')
}

let authPath = resolveAuthPath(undefined)
let cache = null

function parseAuthFile(file) {
  try {
    if (!existsSync(file)) return null
    const value = JSON.parse(readFileSync(file, 'utf8'))
    return value !== null && typeof value === 'object' ? value : null
  } catch {
    return null
  }
}

/** 读凭据。 */
export function readAuth() {
  if (cache !== null) return cache
  const own = parseAuthFile(authPath)
  cache = own
  return cache
}

/** 写凭据（原子替换）；传 null 表示清空。 */
export function writeAuth(record) {
  cache = record
  if (record === null) {
    try {
      if (existsSync(authPath)) writeFileSync(authPath, '')
    } catch {
      /* 尽力而为 */
    }
    return
  }
  const dir = dirname(authPath)
  if (dir !== '' && !existsSync(dir)) mkdirSync(dir, { recursive: true })
  const tmp = `${authPath}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(record, null, 2), { mode: 0o600 })
  renameSync(tmp, authPath)
}

/** 切换凭据路径（配置项生效时调用）。 */
export function useAuthPath(config) {
  const next = resolveAuthPath(config)
  if (next !== authPath) {
    authPath = next
    cache = null
  }
  return authPath
}

export function token() {
  const auth = readAuth()
  return auth !== null && typeof auth.token === 'string' && auth.token !== '' ? auth.token : null
}

/** 面板可见的状态，永不含令牌。 */
export function publicStatus() {
  const auth = readAuth()
  const base = { connected: false, clientId: null, readOnly: isReadOnly() }
  if (auth === null || typeof auth.token !== 'string' || auth.token === '') {
    return { ...base, clientId: typeof auth?.clientId === 'string' ? auth.clientId : null }
  }
  return {
    connected: true,
    readOnly: isReadOnly(),
    login: auth.login ?? null,
    avatarUrl: auth.avatarUrl ?? null,
    name: auth.displayName ?? null,
    kind: auth.kind ?? null,
    scopes: Array.isArray(auth.scopes) ? auth.scopes : [],
    connectedAt: auth.connectedAt ?? null,
    lastVerifiedAt: typeof auth.lastVerifiedAt === 'string' ? auth.lastVerifiedAt : null,
    clientId: typeof auth.clientId === 'string' ? auth.clientId : null,
  }
}

export function rememberClientId(clientId) {
  const auth = readAuth() ?? {}
  writeAuth({ ...auth, clientId })
}

// ── 设置（只读模式）───────────────────────────────────────────────────────

const settingsPath = () => join(dirname(authPath), 'settings.json')

let settingsCache = null

export function readSettings() {
  if (settingsCache !== null) return settingsCache
  try {
    const value = existsSync(settingsPath())
      ? JSON.parse(readFileSync(settingsPath(), 'utf8'))
      : {}
    settingsCache = value !== null && typeof value === 'object' ? value : {}
  } catch {
    settingsCache = {}
  }
  return settingsCache
}

export function writeSettings(patch) {
  settingsCache = { ...readSettings(), ...patch }
  try {
    const dir = dirname(settingsPath())
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(settingsPath(), JSON.stringify(settingsCache, null, 2))
  } catch {
    /* 设置写不进去不影响主流程 */
  }
  return settingsCache
}

/** 只读模式：拦下所有写方法，只放行 GET/HEAD。 */
export function isReadOnly() {
  return readSettings().readOnly === true
}

// ── 调用留痕（内存环形缓冲，用于面板展示「AI 刚刚做了什么」）─────────────

const HISTORY_LIMIT = 40
const history = []

export function recordCall(entry) {
  history.unshift({ at: new Date().toISOString(), ...entry })
  if (history.length > HISTORY_LIMIT) history.length = HISTORY_LIMIT
}

export function recentCalls() {
  return history.slice()
}
