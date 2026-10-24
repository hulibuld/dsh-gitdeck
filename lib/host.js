/**
 * dsh-gitdeck — 插件入口（宿主半边）。
 *
 * 装配顺序：先按配置定好网络层和凭据位置，再分别注入两个面——
 *  - webServer：给浏览器半边用的 /dsh-gitdeck 接口；
 *  - tools + systemPrompt：给模型用的 github_api 工具和提示词。
 *
 * 两个面互不依赖，任何一个注入失败都不该拖垮另一个。
 */
import { configure } from './github.js'
import { handleRequest, ROUTE_PREFIX } from './routes.js'
import { useAuthPath } from './store.js'
import { createPromptSection, createTool } from './tool.js'

export const name = 'dsh-gitdeck'

export function apply(ctx, config = {}) {
  const maxBodyChars =
    typeof config?.maxBodyChars === 'number' && config.maxBodyChars > 0 ? config.maxBodyChars : 60000

  configure(config)
  useAuthPath(config)

  ctx.inject(['webServer'], (hostCtx) => {
    const dispose = hostCtx.webServer.register({
      kind: 'prefix',
      path: ROUTE_PREFIX,
      handler: handleRequest,
    })
    hostCtx.effect(() => dispose, 'dsh-gitdeck: http routes')
  })

  ctx.inject(['tools', 'systemPrompt'], (agentCtx) => {
    agentCtx.tools.register(createTool({ maxBodyChars }))
    agentCtx.systemPrompt.section(createPromptSection())
  })
}
