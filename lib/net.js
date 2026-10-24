/**
 * dsh-gitdeck — 可移植的受信网络层。
 *
 * Why this module exists: different machines reach GitHub differently.
 *  - Some have a local TLS interceptor whose root CA lives in the OS store
 *    but not in Node's bundled store ("unable to verify the first
 *    certificate").
 *  - Some require an HTTP proxy (env vars, or the Windows system proxy).
 *  - Node's built-in fetch honors neither the system proxy nor (without
 *    NODE_OPTIONS=--use-system-ca) the OS CA store.
 *
 * This module builds its own undici dispatcher per host, resolving, in
 * order:
 *   1. explicit plugin config   `proxy: <url>` / `proxy: direct`
 *   2. environment variables    HTTPS_PROXY / HTTP_PROXY / ALL_PROXY /
 *                               NO_PROXY (undici conventions)
 *   3. Windows system proxy     WinINET Internet Settings (registry)
 * and a CA bundle from:
 *   - the Windows certificate store (PowerShell export, cached), or
 *   - standard system CA bundle paths on macOS/Linux.
 * Every step degrades gracefully to the plain global fetch, so the plugin
 * never crashes on a machine it cannot introspect.
 */
import { execFile } from 'node:child_process'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
const MODULE_DIR = dirname(fileURLToPath(import.meta.url))
const CA_CACHE_FILE = join(MODULE_DIR, '..', '.github-ca-cache.pem')
const CA_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

const DEFAULT_NO_PROXY = ['127.0.0.1', 'localhost', '::1']

// Standard system CA bundle locations on non-Windows systems.
const UNIX_CA_PATHS = [
  '/etc/ssl/certs/ca-certificates.crt',
  '/etc/pki/tls/certs/ca-bundle.crt',
  '/etc/ssl/ca-bundle.pem',
  '/etc/pki/tls/cacert.pem',
  '/etc/ssl/cert.pem',
]

// ── NO_PROXY matching ──────────────────────────────────────────────────────

/** Split a NO_PROXY style value into entries (commas/whitespace separated). */
export function parseNoProxy(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return []
  return raw.split(/[,\s]+/).map((entry) => entry.trim()).filter((entry) => entry !== '')
}

/**
 * Standard-ish NO_PROXY semantics: `*`, exact host, host:port, `.domain`
 * suffix, or bare subdomain suffix.
 */
export function bypassesProxy(host, noProxy) {
  const h = String(host).toLowerCase().replace(/^\[|\]$/g, '')
  for (const entry of noProxy) {
    const e = String(entry).toLowerCase().trim()
    if (e === '' || e === '0.0.0.0') continue
    if (e === '*') return true
    const bare = e.split(':')[0]
    if (bare === h) return true
    if (e.startsWith('.')) {
      if (h === e.slice(1) || h.endsWith(e)) return true
    } else if (h.endsWith('.' + bare)) {
      return true
    }
  }
  return false
}

/** Normalize a proxy value ("host:port" or "http://host:port"). */
export function normalizeProxyUrl(proxy) {
  if (typeof proxy !== 'string') return undefined
  const value = proxy.trim()
  if (value === '' || value.toLowerCase() === 'direct' || value.toLowerCase() === 'none') return undefined
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `http://${value}`
}

// ── proxy resolution ───────────────────────────────────────────────────────

/** Environment proxies, undici conventions (lowercase wins, uppercase fallback). */
export function envProxy() {
  const read = (name) => process.env[name] ?? process.env[name.toLowerCase()] ?? undefined
  return {
    https: read('HTTPS_PROXY') ?? undefined,
    http: read('HTTP_PROXY') ?? undefined,
    noProxy: parseNoProxy(process.env.NO_PROXY ?? process.env.no_proxy ?? undefined),
  }
}

/** Windows system proxy from WinINET Internet Settings; undefined elsewhere. */
export async function winSystemProxy() {
  if (process.platform !== 'win32') return undefined
  try {
    const { stdout } = await execFileAsync('reg', [
      'query',
      'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
      '/v', 'ProxyEnable',
    ], { windowsHide: true, timeout: 5000 })
    if (!/0x1\s*$/i.test(String(stdout).trim())) return undefined
  } catch {
    return undefined
  }
  try {
    const { stdout } = await execFileAsync('reg', [
      'query',
      'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
      '/v', 'ProxyServer',
    ], { windowsHide: true, timeout: 5000 })
    const line = String(stdout)
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .find((entry) => /ProxyServer\s+REG_SZ\s+/i.test(entry))
    if (line === undefined) return undefined
    const server = line.replace(/^.*REG_SZ\s+/i, '').trim()
    if (server === '' || server.toLowerCase() === 'none') return undefined
    // "host:port", or "http=host:port;https=host:port;socks=…"
    for (const part of server.split(';')) {
      const m = /^(?:https|http|all)=([^:]+:\d+)$/i.exec(part.trim())
      if (m !== null) return `http://${m[1]}`
    }
    if (/^[^:]+:\d+$/.test(server)) return `http://${server}`
    return undefined
  } catch {
    return undefined
  }
}

/**
 * Resolve the proxy for one https host.
 * @param host - request hostname (e.g. "api.github.com").
 * @param config - plugin config: `proxy` ('auto'|'direct'|url), `noProxy` (string[]).
 */
export async function resolveProxy(host, config = {}) {
  const mode = typeof config.proxy === 'string' && config.proxy !== '' ? config.proxy : 'auto'
  if (mode === 'direct') return undefined
  if (mode !== 'auto') return normalizeProxyUrl(mode)

  const env = envProxy()
  const noProxy = [...DEFAULT_NO_PROXY, ...parseNoProxy(config.noProxy), ...env.noProxy]
  if (bypassesProxy(host, noProxy)) return undefined
  const proxy = env.https ?? env.http ?? (await winSystemProxy())
  return normalizeProxyUrl(proxy)
}

// ── system CA ──────────────────────────────────────────────────────────────

let caCache = null // string | undefined, memoized per process

function unixSystemCaPem() {
  if (process.platform === 'win32') return undefined
  for (const path of UNIX_CA_PATHS) {
    try {
      if (existsSync(path)) return readFileSync(path, 'utf8')
    } catch {
      /* try next */
    }
  }
  return undefined
}

async function winSystemCaPem() {
  const script = `
$sb = New-Object System.Text.StringBuilder
foreach ($loc in 'CurrentUser', 'LocalMachine') {
  foreach ($storeName in 'Root', 'CA') {
    $store = New-Object System.Security.Cryptography.X509Certificates.X509Store($storeName, $loc)
    try {
      $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadOnly)
      foreach ($cert in $store.Certificates) {
        [void]$sb.AppendLine('-----BEGIN CERTIFICATE-----')
        [void]$sb.AppendLine([Convert]::ToBase64String($cert.RawData, [System.Base64FormattingOptions]::InsertLineBreaks))
        [void]$sb.AppendLine('-----END CERTIFICATE-----')
      }
    } catch { } finally { try { $store.Dispose() } catch { } }
  }
}
$sb.ToString()
`
  try {
    const { stdout } = await execFileAsync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
      timeout: 20000,
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    })
    if (typeof stdout === 'string' && stdout.includes('BEGIN CERTIFICATE')) return stdout
  } catch {
    /* no export available */
  }
  return undefined
}

/**
 * A PEM bundle of system-trusted CAs, or undefined when unavailable.
 * Windows: exported from the certificate store (cached in the plugin dir,
 * refreshed after 30 days). macOS/Linux: read from standard bundle paths.
 */
export async function systemCaPem() {
  if (caCache !== null) return caCache
  try {
    if (existsSync(CA_CACHE_FILE) && Date.now() - statSync(CA_CACHE_FILE).mtimeMs < CA_CACHE_MAX_AGE_MS) {
      const cached = readFileSync(CA_CACHE_FILE, 'utf8')
      if (cached.includes('BEGIN CERTIFICATE')) {
        caCache = cached
        return caCache
      }
    }
  } catch {
    /* ignore and re-export */
  }
  const pem = process.platform === 'win32' ? await winSystemCaPem() : unixSystemCaPem()
  if (typeof pem === 'string' && pem.includes('BEGIN CERTIFICATE')) {
    caCache = pem
    try {
      writeFileSync(CA_CACHE_FILE, pem)
    } catch {
      /* cache is best effort */
    }
    return pem
  }
  caCache = undefined
  return undefined
}

// ── dispatcher ─────────────────────────────────────────────────────────────

const dispatcherCache = new Map() // 'direct' | 'proxy:<url>' -> dispatcher | undefined

/**
 * undici dispatcher for one https host, or undefined to use the global fetch.
 * Cached per (direct|proxy) so hosts share one connection pool.
 */
export async function dispatcherFor(host, config = {}) {
  const proxy = await resolveProxy(host, config)
  const key = proxy === undefined ? 'direct' : `proxy:${proxy}`
  if (dispatcherCache.has(key)) return dispatcherCache.get(key)
  const ca = await systemCaPem()
  let dispatcher = undefined
  if (proxy !== undefined || ca !== undefined) {
    // undici 只在真需要代理或自定义 CA 时才加载：直连场景用 Node 自带的
    // fetch 就够了，少一个运行时依赖，少一处安装失败的坑。
    let undici = null
    try {
      undici = await import('undici')
    } catch (error) {
      if (proxy !== undefined) {
        throw new Error(
          `检测到代理 ${proxy}，但当前环境没有 undici，无法走代理。` +
          `请安装 undici，或在插件配置里把 proxy 设为 "direct" 直连。(root: ${error?.message ?? error})`,
        )
      }
    }
    if (undici !== null) {
      try {
        dispatcher = proxy !== undefined
          ? new undici.ProxyAgent({ uri: proxy, requestTls: ca !== undefined ? { ca } : undefined })
          : new undici.Agent({ connect: { ca } })
      } catch {
        dispatcher = undefined
      }
    }
  }
  dispatcherCache.set(key, dispatcher)
  return dispatcher
}
