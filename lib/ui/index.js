/**
 * dsh-gitdeck — 浏览器半边。
 *
 * 挂在对话输入框左下方，一个「Git」小按钮。点开是一个带四个页签的面板：
 * 连接 / 指南 / 设置 / 记录。所有网络请求都打回宿主半边的 /dsh-gitdeck。
 *
 * 写法沿用 profile bundle 的模块约定：window.__ModuleLoader__.load，
 * factory 里拿到 require，组件用 React.createElement 直接拼，不需要打包。
 */
window.__ModuleLoader__.load({
  id: 'dsh-gitdeck',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports

    const React = require('react')
    const NS = 'dsh-gitdeck'
    const GUIDE_KEY = 'dsh-gitdeck:guide-seen'

    const ENDPOINT = {
      status: '/dsh-gitdeck/status',
      verify: '/dsh-gitdeck/verify',
      deviceStart: '/dsh-gitdeck/device/start',
      devicePoll: '/dsh-gitdeck/device/poll',
      pat: '/dsh-gitdeck/pat',
      disconnect: '/dsh-gitdeck/disconnect',
      history: '/dsh-gitdeck/history',
      settings: '/dsh-gitdeck/settings',
    }

    const h = React.createElement

    // ── 请求封装 ──────────────────────────────────────────────────────────

    async function call(path, body) {
      const response = await fetch(path, body === undefined
        ? { credentials: 'same-origin', cache: 'no-store' }
        : {
            method: 'POST',
            credentials: 'same-origin',
            cache: 'no-store',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data?.error ?? `HTTP ${response.status}`)
      return data
    }

    // ── 面板开合状态（按钮与面板共用一个 sessionId）────────────────────────

    const listeners = new Set()
    let openSession = null

    const subscribe = (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    }
    const getOpenSession = () => openSession
    function setOpen(sessionId, open) {
      openSession = open ? sessionId : openSession === sessionId ? null : openSession
      listeners.forEach((fn) => fn())
    }
    function useOpen(sessionId) {
      return React.useSyncExternalStore(subscribe, getOpenSession, () => null) === sessionId
    }

    // ── 首次引导的记忆 ────────────────────────────────────────────────────

    const guideSeen = () => {
      try {
        return window.localStorage.getItem(GUIDE_KEY) === '1'
      } catch {
        return false
      }
    }
    const markGuideSeen = () => {
      try {
        window.localStorage.setItem(GUIDE_KEY, '1')
      } catch {
        /* 无痕模式下最多再弹一次 */
      }
    }

    // ── 按钮 ──────────────────────────────────────────────────────────────

    function Trigger(props) {
      const isOpen = useOpen(props.sessionId)
      const [status, setStatus] = React.useState(null)

      React.useEffect(() => {
        let alive = true
        call(ENDPOINT.status).then((data) => { if (alive) setStatus(data) }).catch(() => {})
        return () => { alive = false }
      }, [isOpen])

      const label = status?.connected ? (status.login ?? 'Git') : 'Git'
      return h('button', {
        type: 'button',
        className: `gd-trigger${isOpen ? ' gd-trigger-open' : ''}${status?.connected ? ' gd-trigger-on' : ''}`,
        title: status?.connected ? `已连接 ${status.login}` : '连接 GitHub',
        onClick: () => setOpen(props.sessionId, !isOpen),
      },
      h('span', { className: 'gd-trigger-dot' }),
      h('span', { className: 'gd-trigger-text' }, label))
    }

    // ── 面板外壳 ──────────────────────────────────────────────────────────

    const TABS = [
      { id: 'connect', label: '连接' },
      { id: 'guide', label: '指南' },
      { id: 'settings', label: '设置' },
      { id: 'history', label: '记录' },
    ]

    function Panel(props) {
      const isOpen = useOpen(props.sessionId)
      const [tab, setTab] = React.useState('connect')
      const [status, setStatus] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [notice, setNotice] = React.useState(null)

      const close = () => setOpen(props.sessionId, false)

      const refresh = React.useCallback(async () => {
        try {
          setStatus(await call(ENDPOINT.status))
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err))
        }
      }, [])

      React.useEffect(() => {
        if (!isOpen) return undefined
        refresh()
        if (!guideSeen() && status?.connected === undefined) {
          // 首次打开且还没决定看哪页时，把指南摆到最前面
        }
        return undefined
      }, [isOpen, refresh])

      React.useEffect(() => {
        if (!isOpen || status?.connected !== true) return undefined
        const timer = setInterval(() => { refresh() }, 30000)
        return () => clearInterval(timer)
      }, [isOpen, status?.connected, refresh])

      if (!isOpen) return null

      const onConnected = (user) => {
        setError(null)
        setNotice(`已连上 ${user.login}`)
        refresh().then(() => {
          if (!guideSeen()) {
            markGuideSeen()
            setTab('guide')
          }
        })
      }

      return h('div', {
        className: 'gd-backdrop',
        onClick: (event) => { if (event.target === event.currentTarget) close() },
      },
      h('div', { className: 'gd-panel', onClick: (event) => event.stopPropagation() },
        h('div', { className: 'gd-head' },
          h('span', { className: 'gd-title' }, 'Git 操作台'),
          h('span', { className: 'gd-sub' }, status?.connected ? `@${status.login}` : '未连接'),
          h('button', { type: 'button', className: 'gd-close', onClick: close, title: '关闭' }, '\u00d7')),

        h('div', { className: 'gd-tabs' }, TABS.map((item) => h('button', {
          key: item.id,
          type: 'button',
          className: `gd-tab${tab === item.id ? ' gd-tab-on' : ''}`,
          onClick: () => setTab(item.id),
        }, item.label))),

        error !== null && h('div', { className: 'gd-error' }, String(error)),
        notice !== null && h('div', { className: 'gd-notice' }, notice),

        tab === 'connect' && h(ConnectTab, { status, busy, setBusy, onConnected, setError, refresh }),
        tab === 'guide' && h(GuideTab, null),
        tab === 'settings' && h(SettingsTab, { status, setStatus }),
        tab === 'history' && h(HistoryTab, null)))
    }

    // ── 页签：连接 ────────────────────────────────────────────────────────

    function ConnectTab(props) {
      const { status, onConnected, setError } = props
      const [mode, setMode] = React.useState('oauth')

      if (status === null) return h('div', { className: 'gd-hint' }, '读取状态…')

      if (status.connected) {
        return h('div', { className: 'gd-stack' },
          h('div', { className: 'gd-user' },
            status.avatarUrl !== null && h('img', { className: 'gd-avatar', src: status.avatarUrl, alt: '' }),
            h('div', { className: 'gd-user-text' },
              h('div', { className: 'gd-user-name' }, status.name ?? status.login ?? 'GitHub'),
              h('div', { className: 'gd-user-meta' }, `@${status.login ?? '?'} · ${status.kind === 'pat' ? 'Token' : 'OAuth'}`))),
          status.scopes.length > 0 && h('div', { className: 'gd-scopes' },
            status.scopes.map((scope) => h('span', { key: scope, className: 'gd-scope' }, scope))),
          h('div', { className: 'gd-meta-grid' },
            h('span', null, '连接于'),
            h('span', null, status.connectedAt ? new Date(status.connectedAt).toLocaleString() : '—'),
            h('span', null, '上次验证'),
            h('span', null, status.lastVerifiedAt ? new Date(status.lastVerifiedAt).toLocaleString() : '—'),
            h('span', null, '写入'),
            h('span', null, status.readOnly ? '只读（拦截写操作）' : '允许')),
          h('div', { className: 'gd-row' },
            h('button', {
              type: 'button',
              className: 'gd-btn',
              onClick: () => {
                props.refresh()
              },
            }, '重新验证'),
            h('button', {
              type: 'button',
              className: 'gd-btn gd-btn-danger',
              onClick: async () => {
                try {
                  await call(ENDPOINT.disconnect, {})
                  props.refresh()
                } catch (err) {
                  setError(err instanceof Error ? err.message : String(err))
                }
              },
            }, '断开连接')))
      }

      return h('div', { className: 'gd-stack' },
        h('div', { className: 'gd-switch-row' },
          h('button', {
            type: 'button',
            className: `gd-seg${mode === 'oauth' ? ' gd-seg-on' : ''}`,
            onClick: () => setMode('oauth'),
          }, 'OAuth 设备流'),
          h('button', {
            type: 'button',
            className: `gd-seg${mode === 'pat' ? ' gd-seg-on' : ''}`,
            onClick: () => setMode('pat'),
          }, '粘贴 Token')),
        mode === 'oauth'
          ? h(DeviceFlow, { initialClientId: status.clientId, onConnected })
          : h(PatForm, { onConnected }))
    }

    function DeviceFlow(props) {
      const [clientId, setClientId] = React.useState(props.initialClientId || '')
      const [phase, setPhase] = React.useState('idle')
      const [code, setCode] = React.useState(null)
      const [error, setError] = React.useState(null)
      const timer = React.useRef(null)

      React.useEffect(() => () => { if (timer.current !== null) clearInterval(timer.current) }, [])

      const stop = () => {
        if (timer.current !== null) {
          clearInterval(timer.current)
          timer.current = null
        }
      }

      const start = async () => {
        setError(null)
        setPhase('starting')
        try {
          const data = await call(ENDPOINT.deviceStart, { clientId: clientId.trim() })
          if (data.error !== undefined) {
            setError(data.error)
            setPhase('idle')
            return
          }
          setCode(data)
          setPhase('waiting')
          window.open(data.verificationUri, '_blank', 'noopener')
          let ticks = 0
          const interval = Math.max(2, data.interval ?? 5)
          timer.current = setInterval(async () => {
            ticks += 1
            if (ticks > Math.ceil((data.expiresIn ?? 900) / interval)) {
              stop()
              setPhase('expired')
              setError('验证码过期了，重新开始一次')
              return
            }
            try {
              const result = await call(ENDPOINT.devicePoll, {
                clientId: clientId.trim(),
                deviceCode: data.deviceCode,
              })
              if (result.status === 'authorized') {
                stop()
                setPhase('done')
                props.onConnected(result.user)
                return
              }
              if (result.status === 'expired' || result.status === 'denied' || result.status === 'error') {
                stop()
                setPhase('idle')
                setError(result.message ?? '授权失败')
              }
            } catch (err) {
              stop()
              setPhase('idle')
              setError(err instanceof Error ? err.message : String(err))
            }
          }, interval * 1000)
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err))
          setPhase('idle')
        }
      }

      return h('div', { className: 'gd-stack' },
        h('label', { className: 'gd-label' }, 'OAuth App Client ID'),
        h('input', {
          className: 'gd-input',
          value: clientId,
          placeholder: 'Iv1.xxxxxxxxxxxx 或 20 位字母数字',
          spellCheck: false,
          onChange: (event) => setClientId(event.target.value),
        }),
        h('div', { className: 'gd-hint' },
          'GitHub → Settings → Developer settings → OAuth Apps → 你自己的应用 → Client ID。没有就新建一个，回调地址填 http://127.0.0.1/。'),
        phase === 'waiting' && code !== null && h('div', { className: 'gd-code-box' },
          h('div', { className: 'gd-code-label' }, '在打开的页面里输入这串码：'),
          h('div', { className: 'gd-code' }, code.userCode),
          h('button', {
            type: 'button',
            className: 'gd-btn',
            onClick: () => window.open(code.verificationUri, '_blank', 'noopener'),
          }, '打开 GitHub 授权页'),
          h('div', { className: 'gd-hint' }, '输完点 Authorize，这里会自动连上。')),
        error !== null && h('div', { className: 'gd-error' }, error),
        h('button', {
          type: 'button',
          className: 'gd-btn gd-btn-primary',
          disabled: phase === 'starting' || phase === 'waiting' || clientId.trim() === '',
          onClick: start,
        }, phase === 'waiting' ? '等待你在 GitHub 上确认…' : phase === 'starting' ? '正在申请…' : '开始连接'))
    }

    function PatForm(props) {
      const [token, setToken] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState(null)

      const submit = async () => {
        setBusy(true)
        setError(null)
        try {
          const data = await call(ENDPOINT.pat, { token })
          if (data.error !== undefined) {
            setError(data.error)
            return
          }
          setToken('')
          props.onConnected(data.user)
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err))
        } finally {
          setBusy(false)
        }
      }

      return h('div', { className: 'gd-stack' },
        h('label', { className: 'gd-label' }, 'Personal Access Token'),
        h('textarea', {
          className: 'gd-input gd-textarea',
          rows: 3,
          value: token,
          placeholder: 'ghp_… 或 github_pat_…',
          spellCheck: false,
          onChange: (event) => setToken(event.target.value),
        }),
        h('div', { className: 'gd-hint' },
          '建议用 fine-grained token，只勾要用的仓库和权限。Token 只存在这台机器上，不进仓库、不上传。'),
        error !== null && h('div', { className: 'gd-error' }, error),
        h('button', {
          type: 'button',
          className: 'gd-btn gd-btn-primary',
          disabled: busy || token.trim() === '',
          onClick: submit,
        }, busy ? '验证中…' : '连接'))
    }

    // ── 页签：指南 ────────────────────────────────────────────────────────

    const GUIDE_STEPS = [
      {
        head: '它现在能做什么',
        body: '以你的身份调用 GitHub 接口：建仓库、传文件、改代码、提 issue、开 PR、读 Actions 日志。你的令牌只发往 api.github.com。',
      },
      {
        head: '怎么使唤它',
        body: '不用记 API。「把我桌面那个文件夹建成私有仓库」「看看这个 PR 为什么挂」「给这个 issue 打上 bug 标签」——说事就行，它自己拼请求。',
      },
      {
        head: '危险动作有闸门',
        body: '删除仓库、强制推送这类操作，它应当先说明再动手。不放心的话，在「设置」里打开只读模式：所有写操作直接拦下。',
      },
      {
        head: '权限与退出',
        body: '随时点「断开连接」立刻作废；也可以去 GitHub → Settings → Applications 撤销。建议用完就断，别常开。',
      },
    ]

    function GuideTab() {
      return h('div', { className: 'gd-stack' },
        h('div', { className: 'gd-guide-title' }, '四件事，看完就够用了'),
        GUIDE_STEPS.map((step, index) => h('div', { key: step.head, className: 'gd-guide-item' },
          h('div', { className: 'gd-guide-head' }, `${index + 1}. ${step.head}`),
          h('div', { className: 'gd-guide-body' }, step.body))))
    }

    // ── 页签：设置 ────────────────────────────────────────────────────────

    function SettingsTab(props) {
      const [readOnly, setReadOnly] = React.useState(props.status?.readOnly === true)
      const [saved, setSaved] = React.useState(false)

      const toggle = async () => {
        const next = !readOnly
        setReadOnly(next)
        try {
          await call(ENDPOINT.settings, { readOnly: next })
          setSaved(true)
          setTimeout(() => setSaved(false), 1600)
        } catch {
          setReadOnly(!next)
        }
      }

      return h('div', { className: 'gd-stack' },
        h('div', { className: 'gd-setting' },
          h('div', { className: 'gd-setting-text' },
            h('div', { className: 'gd-setting-head' }, '只读模式'),
            h('div', { className: 'gd-setting-body' }, '打开后 github_api 只允许 GET，写操作一律拒绝。适合「只想让它看看」的时候。')),
          h('button', {
            type: 'button',
            className: `gd-toggle${readOnly ? ' gd-toggle-on' : ''}`,
            'aria-pressed': readOnly,
            onClick: toggle,
          }, h('span', { className: 'gd-toggle-knob' }))),
        saved && h('div', { className: 'gd-notice' }, '已保存'),
        h('div', { className: 'gd-hint' },
          '网络：默认跟随系统代理与证书。连不上 GitHub 时，在插件配置里设 proxy（或设为 direct 强制直连）。'))
    }

    // ── 页签：记录 ────────────────────────────────────────────────────────

    function HistoryTab() {
      const [calls, setCalls] = React.useState(null)
      const [error, setError] = React.useState(null)

      const load = React.useCallback(async () => {
        try {
          const data = await call(ENDPOINT.history)
          setCalls(Array.isArray(data.calls) ? data.calls : [])
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err))
        }
      }, [])

      React.useEffect(() => { load() }, [load])

      if (error !== null) return h('div', { className: 'gd-error' }, error)
      if (calls === null) return h('div', { className: 'gd-hint' }, '读取中…')
      if (calls.length === 0) {
        return h('div', { className: 'gd-stack' },
          h('div', { className: 'gd-hint' }, '这次启动还没调用过接口。连上之后让我干活，这里会逐条记下来。'))
      }
      return h('div', { className: 'gd-stack' },
        h('div', { className: 'gd-hint' }, '最近 40 次调用（重启后清空）：'),
        calls.map((entry, index) => h('div', {
          key: `${entry.at}-${index}`,
          className: `gd-call${entry.ok ? '' : ' gd-call-bad'}`,
        },
        h('span', { className: 'gd-call-method' }, entry.method),
        h('span', { className: 'gd-call-path' }, entry.path),
        h('span', { className: 'gd-call-status' }, `${entry.status}`),
        h('span', { className: 'gd-call-ms' }, `${entry.ms}ms`))))
    }

    // ── 样式 ──────────────────────────────────────────────────────────────

    const STYLES = `
.gd-trigger, .gd-panel { --gd-accent: #22a06b; --gd-danger: var(--dsw-alias-state-error-primary, #f85149); }
.gd-trigger { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px; border-radius: 14px; border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.3)); background: transparent; color: var(--dsw-alias-label-secondary, #888); font-family: inherit; font-size: 12px; line-height: 1; cursor: pointer; transition: background 120ms ease, color 120ms ease, border-color 120ms ease; }
.gd-trigger:hover { background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.12)); color: var(--dsw-alias-label-primary, #eee); }
.gd-trigger-open { border-color: var(--gd-accent); color: var(--dsw-alias-label-primary, #eee); }
.gd-trigger-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-alias-border-l2, rgba(127,127,127,.5)); }
.gd-trigger-on .gd-trigger-dot { background: var(--gd-accent); }
.gd-trigger-text { max-width: 96px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gd-backdrop { position: fixed; inset: 0; z-index: 200; background: rgba(0,0,0,.42); display: flex; align-items: center; justify-content: center; padding: 24px; box-sizing: border-box; }
.gd-panel { box-sizing: border-box; width: 480px; max-width: calc(100vw - 48px); max-height: min(86vh, 760px); overflow-y: auto; background: var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-layer-1, #1c1c1f)); border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.25)); border-radius: 14px; box-shadow: 0 18px 44px rgba(0,0,0,.42); padding: 16px 18px 18px; color: var(--dsw-alias-label-primary, #eee); font-family: inherit; font-size: 13px; line-height: 1.55; text-align: left; }
.gd-head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 12px; }
.gd-title { font-size: 15px; font-weight: 650; }
.gd-sub { color: var(--dsw-alias-label-secondary, #999); font-size: 12px; }
.gd-close { margin-left: auto; border: 0; background: transparent; color: var(--dsw-alias-label-secondary, #888); font-size: 18px; line-height: 1; cursor: pointer; padding: 0 2px; }
.gd-close:hover { color: var(--dsw-alias-label-primary, #eee); }
.gd-tabs { display: flex; gap: 4px; padding: 3px; border-radius: 10px; background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.10)); margin-bottom: 12px; }
.gd-tab { flex: 1; border: 0; background: transparent; color: var(--dsw-alias-label-secondary, #999); font-family: inherit; font-size: 12px; padding: 6px 0; border-radius: 8px; cursor: pointer; }
.gd-tab-on { background: var(--dsw-alias-bg-base, #fff); color: var(--dsw-alias-label-primary, #111); font-weight: 600; }
.gd-stack { display: flex; flex-direction: column; gap: 10px; }
.gd-row { display: flex; gap: 8px; margin-top: 4px; }
.gd-label { font-size: 12px; color: var(--dsw-alias-label-secondary, #999); }
.gd-input { width: 100%; box-sizing: border-box; padding: 8px 10px; border-radius: 9px; border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.3)); background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.10)); color: var(--dsw-alias-label-primary, #eee); font-family: inherit; font-size: 13px; }
.gd-textarea { resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.gd-input:focus { outline: 2px solid var(--gd-accent); outline-offset: 1px; }
.gd-btn { border: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.45)); background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.12)); color: var(--dsw-alias-label-primary, #eee); font-family: inherit; font-size: 12px; padding: 7px 12px; border-radius: 9px; cursor: pointer; }
.gd-btn:hover:not(:disabled) { border-color: var(--gd-accent); }
.gd-btn:disabled { opacity: .55; cursor: default; }
.gd-btn-primary { background: var(--gd-accent); border-color: var(--gd-accent); color: #fff; }
.gd-btn-danger { color: var(--gd-danger); border-color: color-mix(in srgb, var(--gd-danger) 45%, transparent); background: transparent; }
.gd-hint { color: var(--dsw-alias-label-secondary, #999); font-size: 11.5px; line-height: 1.5; }
.gd-error { color: var(--gd-danger); font-size: 12px; padding: 7px 9px; border-radius: 8px; background: color-mix(in srgb, var(--gd-danger) 10%, transparent); }
.gd-notice { color: var(--gd-accent); font-size: 12px; padding: 6px 9px; border-radius: 8px; background: color-mix(in srgb, var(--gd-accent) 12%, transparent); }
.gd-user { display: flex; align-items: center; gap: 10px; }
.gd-avatar { width: 38px; height: 38px; border-radius: 10px; }
.gd-user-name { font-weight: 600; }
.gd-user-meta { color: var(--dsw-alias-label-secondary, #999); font-size: 12px; }
.gd-scopes { display: flex; flex-wrap: wrap; gap: 4px; }
.gd-scope { font-size: 10.5px; padding: 1px 7px; border-radius: 20px; border: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.4)); color: var(--dsw-alias-label-secondary, #aaa); }
.gd-meta-grid { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; font-size: 12px; color: var(--dsw-alias-label-secondary, #999); }
.gd-switch-row { display: flex; gap: 4px; padding: 3px; border-radius: 10px; background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.10)); }
.gd-seg { flex: 1; border: 0; background: transparent; color: var(--dsw-alias-label-secondary, #999); font-family: inherit; font-size: 12px; padding: 6px 0; border-radius: 8px; cursor: pointer; }
.gd-seg-on { background: var(--dsw-alias-bg-base, #fff); color: var(--dsw-alias-label-primary, #111); font-weight: 600; }
.gd-code-box { display: flex; flex-direction: column; gap: 6px; padding: 10px; border-radius: 10px; background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.10)); }
.gd-code-label { font-size: 11.5px; color: var(--dsw-alias-label-secondary, #999); }
.gd-code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 22px; letter-spacing: 4px; font-weight: 700; color: var(--dsw-alias-label-primary, #eee); }
.gd-guide-title { font-weight: 600; margin-bottom: 2px; }
.gd-guide-item { display: flex; flex-direction: column; gap: 2px; padding: 9px 11px; border-radius: 10px; background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.09)); }
.gd-guide-head { font-size: 12.5px; font-weight: 600; }
.gd-guide-body { font-size: 12px; color: var(--dsw-alias-label-secondary, #999); }
.gd-setting { display: flex; align-items: center; gap: 12px; padding: 10px 11px; border-radius: 10px; background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.09)); }
.gd-setting-text { flex: 1; }
.gd-setting-head { font-weight: 600; font-size: 12.5px; }
.gd-setting-body { font-size: 11.5px; color: var(--dsw-alias-label-secondary, #999); }
.gd-toggle { width: 40px; height: 22px; border-radius: 11px; border: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.45)); background: transparent; position: relative; cursor: pointer; flex: none; }
.gd-toggle-knob { position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: var(--dsw-alias-label-secondary, #999); transition: transform 140ms ease, background 140ms ease; }
.gd-toggle-on { border-color: var(--gd-accent); }
.gd-toggle-on .gd-toggle-knob { transform: translateX(18px); background: var(--gd-accent); }
.gd-call { display: grid; grid-template-columns: 52px 1fr auto auto; gap: 8px; align-items: baseline; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; padding: 5px 8px; border-radius: 7px; background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.07)); }
.gd-call-bad { color: var(--gd-danger); }
.gd-call-method { font-weight: 700; }
.gd-call-path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gd-call-ms { color: var(--dsw-alias-label-secondary, #888); }
`

    // ── 插件入口 ──────────────────────────────────────────────────────────

    function apply(ctx) {
      ctx.effect(() => {
        const tag = document.createElement('style')
        tag.setAttribute('data-plugin', NS)
        tag.textContent = STYLES
        document.head.appendChild(tag)
        return () => {
          if (tag.parentNode !== null) tag.parentNode.removeChild(tag)
        }
      }, `${NS}: styles`)

      ctx.slots.inject('conversation.input.left', () => ctx.slots.register(
        { name: 'conversation.input.left', id: 'gitdeck-trigger', order: 90, label: () => 'Git' },
        (props) => h(Trigger, props)))

      ctx.slots.inject('conversation.input.overlay', () => ctx.slots.register(
        { name: 'conversation.input.overlay', id: 'gitdeck-panel', order: 25, label: () => 'Git 操作台' },
        (props) => h(Panel, props)))
    }

    module.exports = { name: NS, inject: ['slots'], apply }
    return module.exports
  },
})
