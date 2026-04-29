# 小程序 UI 自动化 — 弹幕监听模式使用文档

## 前置条件

1. **微信开发者工具**已打开，且安全设置中开启了"服务端口"
2. 小程序已编译到 `D:/aibz/dist/dev/mp-weixin`（或通过环境变量指定其他路径）
3. Node.js >= 14
4. Ubuntu 上的弹幕解析程序已启动并正在输出 JSONL

## 启动步骤

### 第一步：Ubuntu 上启动弹幕解析

在 Ubuntu 上按正常流程启动自动化直播间项目。启动后会在以下目录生成 JSONL 文件：

```
/home/hermes/auto-live-room/弹幕提取/DouyinLiveWebFetcher/output/{live_id}_{时间戳}.jsonl
```

### 第二步：Windows 上启动 watcher

打开 PowerShell 或 CMD，进入小程序项目目录，执行：

```powershell
cd D:\workspace\aibz

$env:DANMU_JSONL_DIR = "\\wsl$\Ubuntu\home\hermes\auto-live-room\弹幕提取\DouyinLiveWebFetcher\output"
node automation\watch-danmu.js
```

启动后脚本会自动：
1. 连接微信开发者工具（端口 9420）
2. 自动登录小程序（手机号 91231231234，验证码 1111）
3. 监听 JSONL 文件，等待新弹幕写入
4. 每条新弹幕自动执行一轮小程序搜索（打开筛选 → 填条件 → 搜索 → 浏览详情）

## 环境变量

### 必填

| 变量 | 说明 | 示例 |
|------|------|------|
| `DANMU_JSONL_DIR` | JSONL 输出目录的 Windows 路径 | `\\wsl$\Ubuntu\home\hermes\auto-live-room\弹幕提取\DouyinLiveWebFetcher\output` |

### 可选

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `WECHAT_DEVTOOLS_CLI` | `D:/software/微信web开发者工具/cli.bat` | DevTools CLI 路径 |
| `WECHAT_MINIPROGRAM_PROJECT` | `D:/aibz/dist/dev/mp-weixin` | 小程序编译产物路径 |
| `WECHAT_AUTO_PORT` | `9420` | DevTools WebSocket 端口 |
| `DEDUP_WINDOW_MS` | `30000` | 去重窗口（毫秒），相同条件在此时间内不重复执行 |
| `POLL_INTERVAL_MS` | `2000` | 文件轮询间隔（毫秒） |
| `DANMU_LIVE_ID` | 空（不过滤） | 只监听指定 live_id 前缀的文件 |

## 完整启动命令（PowerShell）

```powershell
cd D:\workspace\aibz

# 最简启动（使用默认配置）
$env:DANMU_JSONL_DIR = "\\wsl$\Ubuntu\home\hermes\auto-live-room\弹幕提取\DouyinLiveWebFetcher\output"
node automation\watch-danmu.js

# 指定多个参数
$env:DANMU_JSONL_DIR = "\\wsl$\Ubuntu\home\hermes\auto-live-room\弹幕提取\DouyinLiveWebFetcher\output"
$env:DEDUP_WINDOW_MS = "60000"
$env:POLL_INTERVAL_MS = "3000"
node automation\watch-danmu.js
```

## 完整启动命令（CMD）

```cmd
cd /d D:\workspace\aibz

set DANMU_JSONL_DIR=\\wsl$\Ubuntu\home\hermes\auto-live-room\弹幕提取\DouyinLiveWebFetcher\output
node automation\watch-danmu.js
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

- **城市筛选**：筛选弹窗中城市只有区域选项（京津冀/江浙沪/川渝），当前默认选第一个区域。详见 `KNOWN-ISSUES.md`。
- **弹幕解析精度**：岗位关键词由弹幕解析模块提取，可能存在截断（如"后端工程师"被解析为"后端"）。这是弹幕解析模块的问题，不在本脚本控制范围内。
