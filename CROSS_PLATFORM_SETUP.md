# 微信小程序自动化跨平台运行配置

本文档说明在 macOS 和 Windows 上运行本仓库自动化脚本时，需要分别配置的路径、端口和依赖。

## 通用前置条件

1. 微信开发者工具需要安装并登录。
2. 微信开发者工具中需要开启自动化相关能力：
   - 设置 -> 安全设置 -> 服务端口。
   - 如当前版本有自动化/CLI/HTTP 服务开关，也需要开启。
3. 小程序项目需要先编译出微信小程序产物，并且产物目录里要有 `project.config.json`。
4. `miniprogram-automator` 需要可被脚本加载：
   - 推荐在小程序项目 `/Users/zhoukexuanmac/workspace/aibz` 或 Windows 对应项目根目录下安装。
   - 本仓库的 `lib/automation-core.js` 会优先 `require('miniprogram-automator')`，失败后尝试从相邻 `aibz/node_modules` 查找。
5. 默认自动化端口是 `9420`。如果端口被占用，设置 `WECHAT_AUTO_PORT`。

## macOS 配置

当前已验证的 macOS 路径：

```text
WECHAT_DEVTOOLS_CLI=/Applications/wechatwebdevtools.app/Contents/MacOS/cli
WECHAT_MINIPROGRAM_PROJECT=/Users/zhoukexuanmac/workspace/aibz/dist/build/mp-weixin
WECHAT_AUTO_PORT=9420
```

`automation-core.js` 在 macOS 上已经默认使用以上 CLI 路径和 `../aibz/dist/build/mp-weixin` 项目路径。若本机路径不同，可显式设置环境变量：

```bash
export WECHAT_DEVTOOLS_CLI="/Applications/wechatwebdevtools.app/Contents/MacOS/cli"
export WECHAT_MINIPROGRAM_PROJECT="/Users/zhoukexuanmac/workspace/aibz/dist/build/mp-weixin"
export WECHAT_AUTO_PORT=9420
```

手动启动 auto 模式：

```bash
"/Applications/wechatwebdevtools.app/Contents/MacOS/cli" auto \
  --project "/Users/zhoukexuanmac/workspace/aibz/dist/build/mp-weixin" \
  --auto-port 9420 \
  --trust-project
```

验证端口：

```bash
nc -zv 127.0.0.1 9420
```

运行 watcher 示例：

```bash
export DANMU_JSONL_DIR="/path/to/danmu/output"
node watch-danmu.js
```

## Windows 配置

Windows 默认配置仍保持向后兼容：

```text
WECHAT_DEVTOOLS_CLI=D:/software/微信web开发者工具/cli.bat
WECHAT_MINIPROGRAM_PROJECT=D:/aibz/dist/dev/mp-weixin
WECHAT_AUTO_PORT=9420
```

如果当前 Windows 项目实际也使用 build 产物，请改为：

```powershell
$env:WECHAT_DEVTOOLS_CLI = "D:/software/微信web开发者工具/cli.bat"
$env:WECHAT_MINIPROGRAM_PROJECT = "D:/aibz/dist/build/mp-weixin"
$env:WECHAT_AUTO_PORT = "9420"
```

手动启动 auto 模式：

```powershell
& "D:/software/微信web开发者工具/cli.bat" auto `
  --project "D:/aibz/dist/build/mp-weixin" `
  --auto-port 9420 `
  --trust-project
```

如果仍使用 dev 产物，把 `dist/build/mp-weixin` 换成 `dist/dev/mp-weixin`。

验证端口：

```powershell
netstat -ano | findstr ":9420" | findstr "LISTENING"
```

运行 watcher 示例：

```powershell
$env:DANMU_JSONL_DIR = "D:/path/to/danmu/output"
node watch-danmu.js
```

## 常见问题

- 端口未监听：先用 CLI 的 `auto` 命令启动自动化窗口。
- 端口监听但连接失败：确认脚本运行环境允许访问本机 WebSocket；macOS 沙箱环境可能需要提升权限。
- 项目路径错误：确认 `WECHAT_MINIPROGRAM_PROJECT/project.config.json` 存在。
- 多个“更多”点错：当前脚本已限定城市 section，不再点击学历或岗位类型的“更多”。
- 城市被选成全省：当前脚本只点击左侧 `.province-name`，右侧精确点击 `.city-name`，找不到具体城市时不会保存全省选择。
