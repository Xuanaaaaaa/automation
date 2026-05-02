# 微信小程序自动化跨平台运行配置

本文档说明在 macOS 和 Windows 上首次 clone 本仓库后，如何完成本机路径初始化，并运行弹幕监听自动化。

## 快速初始化

进入本仓库根目录，运行：

```bash
node scripts/init-local-config.js
```

脚本会提示输入本机配置，直接回车会使用方括号中的默认值。完成后会生成：

```text
config/local.jsonl
```

该文件只保存本机路径，已加入 `.gitignore`，不会提交到仓库。

当前读取优先级是：

```text
环境变量 > config/local.jsonl > config/local.json > 内置默认值
```

也就是说，日常运行用 `config/local.jsonl`；临时调试时仍可以用环境变量覆盖。

## 配置字段

`config/local.jsonl` 是一行 JSON 对象，示例见 `config/local.example.jsonl`：

```json
{"wechatDevtoolsCli":"/Applications/wechatwebdevtools.app/Contents/MacOS/cli","wechatMiniprogramProject":"/Users/your-name/workspace/aibz/dist/build/mp-weixin","wechatAutoPort":9420,"danmuJsonlDir":"/Users/your-name/workspace/自动化直播间/弹幕提取/DouyinLiveWebFetcher/output","noProxy":"127.0.0.1,localhost,::1"}
```

字段含义：

| 字段 | 说明 |
|------|------|
| `wechatDevtoolsCli` | 微信开发者工具 CLI 路径 |
| `wechatMiniprogramProject` | 小程序 `mp-weixin` 编译产物路径，目录内应有 `project.config.json` |
| `wechatAutoPort` | DevTools 自动化 WebSocket 端口，默认 `9420` |
| `danmuJsonlDir` | 弹幕解析模块输出 JSONL 的目录 |
| `noProxy` | 本地地址绕过代理，建议保留 `127.0.0.1,localhost,::1` |

等价环境变量：

```text
WECHAT_DEVTOOLS_CLI
WECHAT_MINIPROGRAM_PROJECT
WECHAT_AUTO_PORT
DANMU_JSONL_DIR
NO_PROXY / no_proxy
```

## macOS 示例

常见路径：

```text
wechatDevtoolsCli=/Applications/wechatwebdevtools.app/Contents/MacOS/cli
wechatMiniprogramProject=/Users/你的用户名/workspace/aibz/dist/build/mp-weixin
wechatAutoPort=9420
danmuJsonlDir=/Users/你的用户名/workspace/自动化直播间/弹幕提取/DouyinLiveWebFetcher/output
```

如果本机有代理环境变量，建议保留：

```text
noProxy=127.0.0.1,localhost,::1
```

## Windows 示例

常见路径：

```text
wechatDevtoolsCli=D:/software/微信web开发者工具/cli.bat
wechatMiniprogramProject=D:/aibz/dist/build/mp-weixin
wechatAutoPort=9420
danmuJsonlDir=D:/path/to/DouyinLiveWebFetcher/output
noProxy=127.0.0.1,localhost
```

如果小程序仍使用 dev 产物，把 `dist/build/mp-weixin` 换成 `dist/dev/mp-weixin`。

如果弹幕输出在 WSL 中，`danmuJsonlDir` 可以填 Windows 可访问路径，例如：

```text
\\wsl$\Ubuntu\home\hermes\auto-live-room\弹幕提取\DouyinLiveWebFetcher\output
```

## 手动启动 DevTools Auto 模式

通常脚本会自动启动 auto 模式。需要手动排查时，可用配置里的 CLI 和项目路径运行：

macOS:

```bash
"/Applications/wechatwebdevtools.app/Contents/MacOS/cli" auto \
  --project "/Users/你的用户名/workspace/aibz/dist/build/mp-weixin" \
  --auto-port 9420 \
  --trust-project
```

Windows PowerShell:

```powershell
& "D:/software/微信web开发者工具/cli.bat" auto `
  --project "D:/aibz/dist/build/mp-weixin" `
  --auto-port 9420 `
  --trust-project
```

## 运行 watcher

初始化完成后，直接运行：

```bash
node watch-danmu.js
```

如需临时覆盖弹幕目录：

```bash
DANMU_JSONL_DIR="/tmp/danmu-output" node watch-danmu.js
```

Windows PowerShell:

```powershell
$env:DANMU_JSONL_DIR = "D:/tmp/danmu-output"
node watch-danmu.js
```

## 常见问题

- 端口未监听：确认微信开发者工具已安装，CLI 路径正确，且 DevTools 安全设置中开启服务端口。
- 端口监听但连接失败：确认当前运行环境允许访问本机 WebSocket；在代理环境下设置 `NO_PROXY/no_proxy`。
- 项目路径错误：确认 `wechatMiniprogramProject/project.config.json` 存在。
- `miniprogram-automator` 找不到：在本仓库或相邻小程序项目中安装依赖；当前代码也会尝试从相邻 `aibz/node_modules` 加载。
- 城市被选成全省：当前脚本只点击左侧省份名称，右侧精确点击城市名称，找不到具体城市时不会保存全省选择。
