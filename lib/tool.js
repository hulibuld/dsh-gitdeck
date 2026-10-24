/**
 * dsh-gitdeck — 面向模型的 github_api 工具。
 *
 * 手写 ToolDefinition（不用 defineTool）：第三方插件装在 profile 里时拿不到
 * @deepseek-ai/* 包，运行时 import 会解析失败。这里只依赖文档化的契约——
 * name / description / parameters + output.schema / output.render + execute。
 *
 * 相比"能用就行"的版本，多了两道保险：
 *  - 只读模式：打开后只放行 GET/HEAD，写操作直接被拦下并说明原因；
 *  - 调用留痕：每次调用记一条（方法、路径、状态、耗时），面板里能看到
 *    AI 刚碰过什么，出错时不用猜。
 */
import { callApi } from './github.js'
import { isReadOnly, recentCalls, recordCall, token } from './store.js'

const METHODS = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE']

export const TOOL_NAME = 'github_api'

export function createTool({ maxBodyChars = 60000 } = {}) {
  return {
    name: TOOL_NAME,
    description:
      'Call the GitHub REST API with the GitHub account the user connected through the composer button. ' +
      'Use it for issues, pull requests, repositories, gists, workflow runs, contents and any other ' +
      'api.github.com endpoint. Read first; explain before destructive writes.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        method: {
          type: 'string',
          enum: METHODS,
          description: 'HTTP 方法：GET / POST / PATCH / PUT / DELETE。',
        },
        path: {
          type: 'string',
          description:
            '相对 https://api.github.com 的路径，以 / 开头，例如 /repos/{owner}/{repo}/issues。' +
            '允许查询串（/search/issues?q=repo:a/b is:open），非 ASCII 段会自动编码。',
        },
        body: {
          type: 'object',
          additionalProperties: true,
          description: '写操作的 JSON 请求体，可省略。',
        },
      },
      required: ['method', 'path'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          status: { type: 'integer' },
          error: { type: 'string' },
          body: { type: 'string' },
          rateLimit: { type: 'string' },
        },
        required: ['ok'],
      },
      render: (args, value) => [{
        type: 'text',
        text: `github_api ${String(args?.method ?? '').toUpperCase()} ${String(args?.path ?? '')} -> HTTP ${value?.status ?? 0}\n${value?.error ?? value?.body ?? ''}`.slice(0, 4000),
      }],
    },
    timeoutMs: 60000,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const started = Date.now()
      const method = typeof args?.method === 'string' ? args.method.toUpperCase() : ''
      const path = typeof args?.path === 'string' ? args.path : ''
      const finish = (result) => {
        recordCall({
          method,
          path,
          status: result.status,
          ok: result.ok === true,
          ms: Date.now() - started,
          error: result.ok === true ? null : (result.error ?? null),
        })
        return result
      }

      if (!METHODS.includes(method)) {
        return finish({ ok: false, status: 400, error: `不认识的 method：${String(args?.method ?? '')}（可用 ${METHODS.join('/')}）` })
      }
      if (isReadOnly() && method !== 'GET') {
        return finish({
          ok: false,
          status: 403,
          error: `只读模式开着，${method} 被拦下了。需要写操作就在面板「设置」里关掉只读，或者自己改完再让我看。`,
        })
      }
      const authToken = token()
      if (authToken === null) {
        return finish({
          ok: false,
          status: 401,
          error: 'GitHub 还没连接。点对话框左下角的 Git 按钮授权（设备流或粘贴 Token），再继续。',
        })
      }
      const result = await callApi({
        token: authToken,
        method,
        path,
        body: args?.body,
        maxBodyChars,
        signal: exec?.signal,
      })
      return finish({
        ok: result.status >= 200 && result.status < 300,
        status: result.status,
        ...(result.message !== undefined ? { error: result.message } : {}),
        ...(result.body !== undefined ? { body: result.body } : {}),
        ...(result.rateLimit !== undefined ? { rateLimit: result.rateLimit } : {}),
      })
    },
  }
}

export function createPromptSection() {
  return {
    name: `tool:${TOOL_NAME}`,
    order: 112,
    text:
      'The user may connect a GitHub account through the Git button at the bottom-left of the chat composer ' +
      '(OAuth device flow or a personal access token). When connected, use the github_api tool to act on that ' +
      'account: issues, pull requests, repositories, gists, workflow runs, contents, etc. Prefer read-only calls ' +
      'first and explain what will change before destructive writes. If github_api reports that GitHub is not ' +
      'connected or returns status 401, do not retry — ask the user to click the Git button in the composer and ' +
      'authorize. If it reports that read-only mode is on (status 403 on a write), do not retry either: tell the ' +
      'user to switch read-only off in the Git panel settings.',
  }
}

export { recentCalls }
