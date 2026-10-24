# dsh-gitdeck

在 DeepSeek Harness 里接上你的 GitHub 账号：对话框左下角点「Git」，授权一次，之后让 AI 以你的身份建仓库、传文件、改代码、提 issue、开 PR、读 Actions 日志。

令牌只存在你这台机器上（`~/.dsh/.dsh-gitdeck/auth.json`，权限 0600），不会进上下文、不会进仓库、不会出现在任何日志里。

## 装

```bash
dsh plugin --profile desktop add link:/path/to/dsh-gitdeck
```

或者发到 npm 之后直接 `npm i -g` 到 profile（市场里搜 `dsh-gitdeck`）。装完重启 DSH，输入框左下角多一个「Git」按钮。

## 连

两条路，任选一条：

**A. OAuth 设备流（推荐）**

1. GitHub → Settings → Developer settings → OAuth Apps → New OAuth App
2. 名字随便填，回调地址填 `http://127.0.0.1/`
3. 复制 Client ID，粘进面板，点「开始连接」
4. 浏览器会自动打开，输入面板上的 8 位码，点 Authorize
5. 回到 DSH，面板自己变成「已连接 @你的用户名」

**B. 粘贴 Token**

fine-grained token 更安全：只勾要用的仓库和权限（Contents 读写、Issues、Pull requests）。

## 用

连上之后不用记 API，直接说事：

- 「把桌面那个文件夹建成私有仓库」
- 「看看这个 PR 的 CI 为什么挂」
- 「给这个 issue 打上 bug 标签」
- 「把 README 里那段的错字改掉，提个 PR」

AI 通过 `github_api` 工具发请求，路径、查询串、中文文件名都能处理。

## 三道保险

| 保险 | 说明 |
| --- | --- |
| 只读模式 | 面板「设置」里打开，只放行 GET，写操作一律 403 |
| 调用留痕 | 面板「记录」里能看到每次调用的方法、路径、状态码、耗时（重启清空） |
| 随时断开 | 面板「断开连接」立刻作废；也可以去 GitHub → Settings → Applications 撤销授权 |

## 排障

- **连不上授权页**：`github.com` 的 443 有时被墙，但 `api.github.com` 通。设备流需要访问 github.com，先确认浏览器能打开。
- **要走代理**：插件配置里设 `proxy: "http://127.0.0.1:7890"`，或设 `proxy: "direct"` 强制直连。
- **状态不对**：面板关掉再打开，会重新读一次状态；「重新验证」会拿当前令牌打一次 `/user`。

## License

MIT
