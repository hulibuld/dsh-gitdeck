# dsh-gitdeck

[![npm](https://img.shields.io/npm/v/dsh-gitdeck)](https://www.npmjs.com/package/dsh-gitdeck)
[![月下载](https://img.shields.io/npm/dm/dsh-gitdeck)](https://www.npmjs.com/package/dsh-gitdeck)
[![DSH](https://img.shields.io/badge/DSH-0.2.x-blue)](https://github.com/hulibuld/dsh-gitdeck)
[![License](https://img.shields.io/npm/l/dsh-gitdeck)](LICENSE)

`dsh plugin --profile desktop add dsh-gitdeck` · [装不上就开个 issue](https://github.com/hulibuld/dsh-gitdeck/issues/new/choose)

在 DeepSeek 里连自己的 GitHub。输入框左下角点 Git，授权一次，之后就能让 AI 以你的身份建仓库、传文件、改代码、提 issue、开 PR、看 Actions 日志。

令牌只放本机 `~/.dsh/.dsh-gitdeck/auth.json`，权限 0600。不进上下文，不进仓库，不进日志。

## 装

```
dsh plugin --profile desktop add dsh-gitdeck
```

装完重启 DSH。插件不走热重载。重启后左下角多个 Git。

从源码装的话，把包名换成你 clone 下来的目录，前面加 `link:`。

## 连

OAuth 设备流。GitHub 的 Settings → Developer settings → OAuth Apps → New OAuth App，回调地址填 `http://127.0.0.1/`。建完复制 Client ID 粘进面板，点开始连接。浏览器会开，输入面板上那 8 位码，Authorize，回 DSH，面板自己变成已连接。

不想建 OAuth App 就粘 token。fine-grained 的就行，勾上 Contents 读写、Issues、Pull requests。

## 用

连上之后不用记 API，直接说话。

「把桌面那个文件夹建成私有仓库」「看看这个 PR 的 CI 为什么挂」「给这个 issue 打个 bug 标签」「README 里那段错字改掉，提个 PR」。

## 三道保险

只读模式。设置里打开，只放行 GET，写操作一律 403。

调用留痕。记录页签能看到每次调用的方法、路径、状态码、耗时。重启清空。

随时断开。面板点断开立刻作废，也可以去 GitHub 的 Settings → Applications 撤销授权。

## 排障

连不上授权页，多半是 github.com 的 443 不通。设备流要访问 github.com，先在浏览器里试着打开。

要走代理，配置里写 `proxy` 填地址，或者填 `direct` 强制直连。

状态看着不对，面板关掉再打开会重新读一次。还不对点重新验证，拿当前令牌打一次 `/user`。

## 已知问题与修复记录

0.1.0 到 0.1.1 之间没有独立提交，那一段压成了一条，所以这表按版本记，能确认的才写。

| 版本 | 日期 | 现象 | 原因 | 修复方式 |
| --- | --- | --- | --- | --- |
| 0.1.1 | 2026-10-24 | 未记录 | 未记录 | 未记录 |
| 0.1.0 | 2026-10-24 | 首个版本 | — | — |

以后每修一次加一行，写清版本、日期、现象、原因、修法。原因写不出就写未记录，别猜。

## License

MIT
