# 小程序 UI 自动化 — 弹幕监听模式使用文档

## 前置条件

1. **微信开发者工具**已打开，且安全设置中开启了"服务端口"
2. 小程序已编译到 `mp-weixin` 产物目录，且目录内有 `project.config.json`
3. Node.js >= 14
4. 弹幕解析程序已启动并正在输出 JSONL
5. 首次运行前已完成本机配置初始化：

```bash
node scripts/init-local-config.js
```

初始化会生成 `config/local.jsonl`，保存本机 DevTools CLI、mp-weixin 产物路径、自动化端口和弹幕 JSONL 输出目录。

## 启动步骤

### 第一步：Ubuntu 上启动弹幕解析

在 Ubuntu 上按正常流程启动自动化直播间项目。启动后会在以下目录生成 JSONL 文件：

```
/home/hermes/auto-live-room/弹幕提取/DouyinLiveWebFetcher/output/{live_id}_{时间戳}.jsonl
```

### 第二步：启动 watcher

进入本仓库目录，执行：

```bash
node watch-danmu.js
```

启动后脚本会自动：
1. 连接微信开发者工具（端口 9420）
2. 自动登录小程序（手机号 91231231234，验证码 1111）
3. 监听 JSONL 文件，等待新弹幕写入
4. 每条新弹幕自动执行一轮小程序搜索（打开筛选 → 填条件 → 搜索 → 浏览详情）

## 本地配置和环境变量

推荐把本机长期配置写入 `config/local.jsonl`：

```json
{"wechatDevtoolsCli":"/Applications/wechatwebdevtools.app/Contents/MacOS/cli","wechatMiniprogramProject":"/Users/your-name/workspace/aibz/dist/build/mp-weixin","wechatAutoPort":9420,"danmuJsonlDir":"/path/to/DouyinLiveWebFetcher/output","noProxy":"127.0.0.1,localhost,::1"}
```

读取优先级：

```text
环境变量 > config/local.jsonl > config/local.json > 内置默认值
```

等价环境变量：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DANMU_JSONL_DIR` | `config/local.jsonl` 中的 `danmuJsonlDir` | JSONL 输出目录 |
| `WECHAT_DEVTOOLS_CLI` | 系统内置默认值 | DevTools CLI 路径 |
| `WECHAT_MINIPROGRAM_PROJECT` | 系统内置默认值 | 小程序编译产物路径 |
| `WECHAT_AUTO_PORT` | `9420` | DevTools WebSocket 端口 |
| `DEDUP_WINDOW_MS` | `30000` | 去重窗口（毫秒），相同条件在此时间内不重复执行 |
| `POLL_INTERVAL_MS` | `2000` | 文件轮询间隔（毫秒） |
| `DANMU_LIVE_ID` | 空（不过滤） | 只监听指定 live_id 前缀的文件 |

## 完整启动命令（PowerShell）

```powershell
cd D:\workspace\automation

# 最简启动（使用 config/local.jsonl）
node watch-danmu.js

# 指定多个参数
$env:DANMU_JSONL_DIR = "\\wsl$\Ubuntu\home\hermes\auto-live-room\弹幕提取\DouyinLiveWebFetcher\output"
$env:DEDUP_WINDOW_MS = "60000"
$env:POLL_INTERVAL_MS = "3000"
node watch-danmu.js
```

## 完整启动命令（CMD）

```cmd
cd /d D:\workspace\automation

set DANMU_JSONL_DIR=\\wsl$\Ubuntu\home\hermes\auto-live-room\弹幕提取\DouyinLiveWebFetcher\output
node watch-danmu.js
```

## 运行时行为

- **只处理新内容**：启动后从 JSONL 文件末尾开始读，不处理历史记录
- **自动发现新文件**：弹幕程序重启生成新文件时，自动切换到新文件
- **串行执行**：同一时间只执行一个搜索任务，多条弹幕排队处理
- **自动去重**：30 秒内相同岗位+城市+学历条件只执行一次
- **状态回写**：执行状态（started/done/failed）会写回 JSONL 文件

## 停止

按 `Ctrl+C` 停止。脚本会等待当前正在执行的任务完成后再退出。

## 日志和截图

每次运行在 `automation/test-runs/watch-{时间戳}/` 下生成：

```
test-runs/watch-2026-04-29T03-38-27/
├── test.log                          # 运行日志
└── screenshots/
    ├── 0-login-page.png              # 登录页截图
    ├── 0-login-result.png            # 登录结果
    ├── 1-filter.png                  # 筛选条件填写
    ├── 1-result.png                  # 搜索结果
    ├── 1-detail-top.png              # 岗位详情顶部
    └── 1-detail-scrolled.png         # 岗位详情滚动后
```

## 已知限制

- **弹幕解析精度**：岗位关键词由弹幕解析模块提取，可能存在截断（如"后端工程师"被解析为"后端"）。这是弹幕解析模块的问题，不在本脚本控制范围内。
- **本机代理**：如果设置了 `http_proxy/https_proxy`，建议在 `config/local.jsonl` 中保留 `noProxy`，避免本地 DevTools WebSocket 被代理影响。
