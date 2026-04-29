# AIBZ MiniProgram Automation -- 技术报告

## 一、Automation 模块详解

### 1.1 设计目标与核心功能

本模块为 AIBZ 微信小程序提供一套 **端到端的自动化测试工作流**，核心能力包括：

- **自动登录**：使用测试账号（手机号 + 固定验证码）完成登录流程
- **批量筛选查询**：从 JSON 文件读取多组筛选条件，依次填入搜索页筛选弹窗
- **岗位详情浏览**：自动点击搜索结果中的岗位项，进入详情页
- **模拟人类滑动**：基于阻尼衰减模型模拟真实手指滑动行为，避免被平台识别为机器人
- **全程日志与截图**：每一步操作均有时间戳日志和截图归档，便于事后审计

**设计约束：**
- 单脚本文件（`loop-search.js`），不拆分模块，便于一次部署
- 连接后不断开（保持登录态），避免页面重启导致状态丢失
- 不使用 `reLaunch()`（会清空登录态），仅使用 `switchTab` / `navigateTo` / `navigateBack`

### 1.2 关键技术栈与依赖项

| 组件 | 用途 |
|------|------|
| `miniprogram-automator` | 微信小程序官方自动化 SDK，通过 WebSocket 与 DevTools 通信 |
| `child_process` (`cp.execSync`) | 调用 `cli.bat auto` 启动 DevTools 的 auto 模式 |
| `fs` / `path` | 日志写入、截图保存、测试产物目录管理 |
| 微信开发者工具 CLI (`cli.bat`) | 提供 `auto` 子命令开启 WebSocket 自动化端口 |

**版本要求：**
- Node.js >= 14
- 微信开发者工具已安装，且 `cli.bat` 路径正确
- `miniprogram-automator` 已安装（`npm install miniprogram-automator`）

### 1.3 模块架构分层

```
┌─────────────────────────────────────────────────┐
│                  调度层 (main)                   │
│  parseArgs() → connect() → ensureLoggedIn()     │
│  → for each query: runOneCycle()                │
├─────────────────────────────────────────────────┤
│                 执行层 (actions)                 │
│  navigateToSearch → openFilter → fillFilters    │
│  → submitMatch → enterJobAndScroll → goBack     │
├─────────────────────────────────────────────────┤
│              滑动引擎 (smoothScroll)             │
│  阻尼衰减模型 + requestAnimationFrame 节奏       │
│  延迟起步 + touchend 静止等待                    │
├─────────────────────────────────────────────────┤
│              基础设施层 (infra)                  │
│  connect/startAutoMode (DevTools 生命周期)       │
│  screenshot/log/sleep (工具函数)                 │
│  日志 + 截图归档 (test-runs/)                    │
└─────────────────────────────────────────────────┘
```

---

## 二、脚本执行全流程（从零到运行）

### 2.1 环境准备阶段

#### 2.1.1 前置条件

```
1. 微信开发者工具已安装于 D:/software/微信web开发者工具/
2. 项目已编译到 D:/aibz/dist/dev/mp-weixin
3. npm install miniprogram-automator 已执行
4. DevTools 设置 → 安全 → 服务端口 已开启
```

#### 2.1.2 DevTools 连接机制

连接采用**两步策略**：

```
Step 1: 检测端口 → 如果 9420 已在监听，跳过启动
Step 2: 如果未监听 → 调用 cli.bat auto 启动新实例
Step 3: automator.connect() 连接 WebSocket
Step 4: 轮询 currentPage() 等待小程序加载完成
```

**关键代码片段：**

```javascript
async function connect() {
  await startAutoMode()  // 确保 DevTools 在 auto 模式下运行

  for (let i = 1; i <= 5; i++) {
    const mp = await automator.connect({
      wsEndpoint: 'ws://127.0.0.1:9420'
    })
    // 等待小程序页面就绪
    for (let j = 0; j < 10; j++) {
      const page = await mp.currentPage()
      if (page && page.path) return mp
      await sleep(2000)
    }
  }
}
```

**为什么不用 `automator.launch()`？**

`automator.launch()` 内部传递的参数会触发 DevTools 编译器的 `MaxSubPackageLimit` 崩溃（DevTools 自身 bug）。改用 `cp.execSync("cli.bat auto ...")` 直接调用 CLI 启动，再用 `automator.connect()` 连接，可以绕过此问题。

### 2.2 部署与启动阶段

#### 2.2.1 命令行入口

```bash
# 批量模式：从 JSON 文件读取多组查询
node automation/loop-search.js --file automation/test-queries.json

# 单条模式：直接传入 JSON
node automation/loop-search.js --input '{"position":"Java开发","education":"本科"}'
```

#### 2.2.2 初始化流程

```
main()
  ├── initRunDir()           # 创建 test-runs/<timestamp>/ 目录
  ├── parseArgs()            # 解析 --file 或 --input 参数
  ├── connect()              # 连接 DevTools（含自动启动）
  ├── ensureLoggedIn(mp)     # 自动登录流程
  └── for each query:
        └── runOneCycle(mp, criteria, index)
```

#### 2.2.3 测试产物结构

```
automation/test-runs/
  2026-04-28T19-04-21/
    test.log                 # 全程时间戳日志
    screenshots/
      0-login-page.png       # 登录页截图
      0-login-result.png     # 登录结果
      1-filter.png           # 第1轮筛选条件
      1-result.png           # 第1轮搜索结果
      1-detail-top.png       # 第1轮详情页顶部
      1-detail-scrolled.png  # 第1轮滑动后
      2-filter.png           # 第2轮...
      ...
```

### 2.3 自动化操作细节

#### 2.3.1 登录流程 (`ensureLoggedIn`)

```
ensureLoggedIn(mp)
  ├── 检测当前页面
  ├── 如果已在 phoneLogin → 直接使用
  ├── 否则 → navigateTo('/pages/login/phoneLogin')
  ├── 填入手机号: 91231231234
  ├── 勾选用户协议 (.agreement-checkbox)
  ├── 点击获取验证码 (.code-btn)
  ├── 填入验证码: 1111
  ├── 点击登录按钮 (.form-button)
  └── 验证跳转成功
```

**选择器映射表：**

| 选择器 | 元素 | 页面 |
|--------|------|------|
| `.input` (第1个) | 手机号输入框 | login/phoneLogin |
| `.input` (第2个) | 验证码输入框 | login/phoneLogin |
| `.agreement-checkbox` | 用户协议勾选 | login/phoneLogin |
| `.code-btn` | 获取验证码按钮 | login/phoneLogin |
| `.form-button` | 登录按钮 | login/phoneLogin |
| `.filter-icon` | 筛选图标 | position/search |
| `.input-field` | 筛选输入框 | position/search |
| `.option-btn` | 筛选选项按钮 | position/search |
| `.confirm-btn` | 开始匹配按钮 | position/search |
| `.position-news` | 结果统计文本 | position/search |
| `.job-item` | 岗位卡片内部 view | position/search |

#### 2.3.2 单次循环 (`runOneCycle`)

```
runOneCycle(mp, criteria, index)
  ├── navigateToSearch(mp)
  │     └── switchTab('/pages/position/search') 或 navigateTo
  ├── openFilter(page)
  │     └── tap .filter-icon → waitFor .confirm-btn
  ├── fillFilters(page, criteria)
  │     ├── position → inputs[0]
  │     ├── company → inputs[2]
  │     └── education/companyType/job_type → 匹配 .option-btn 文本并 tap
  ├── submitMatch(page)
  │     └── tap .confirm-btn → sleep(15s) → 读取结果
  ├── enterJobAndScroll(mp, page, cycleIndex)
  │     ├── tap .job-item → 等待跳转到 detail 页
  │     ├── 找到 scroll-view
  │     └── 5 次 smoothScroll (300px/次)
  └── goBack(mp)
        └── navigateBack() 或 switchTab 回搜索页
```

#### 2.3.3 筛选条件填写逻辑

```javascript
async function fillFilters(page, criteria) {
  const inputs = await page.$$('.input-field')
  // inputs[0] = 职位名称, inputs[2] = 公司名称
  if (criteria.position) await inputs[0].input(criteria.position)
  if (criteria.company) await inputs[2].input(criteria.company)

  const optionBtns = await page.$$('.option-btn')
  // 遍历所有 .option-btn，文本匹配则 tap
  for (const key of ['education', 'companyType', 'job_type']) {
    const target = criteria[key]
    for (const btn of optionBtns) {
      if (await btn.text() === target) { await btn.tap(); break }
    }
  }
}
```

### 2.4 调试与修复

#### 2.4.1 常见报错场景与修复

| 报错 | 原因 | 修复方案 |
|------|------|----------|
| `timeout waiting for automator response` | 页面导航超时或 DevTools 未就绪 | 增加等待时间；使用 `waitForReady` 轮询 |
| `Cannot read properties of undefined (reading 'MaxSubPackageLimit')` | `automator.launch()` 触发 DevTools 编译器 bug | 改用 `cp.execSync("cli.bat auto ...")` 启动 |
| `page destroyed` | 页面在操作前被销毁 | 增加导航后 sleep；重新获取 page 引用 |
| `xtx-job-item` tap 无效 | 自定义组件的 tap 不触发内部事件 | 改用 `.job-item`（组件内部 view 元素） |
| `pageScrollTo` 无视觉效果 | 只设置数值，不触发动画 | 改用 `scrollview.scrollTo()` |
| 滑动不自然 | 匀速跳转，像机器人 | 使用 smoothScroll 阻尼模型 |

#### 2.4.2 排查思路

```
1. 检查端口: netstat -ano | findstr "9420" | findstr "LISTENING"
2. 检查进程: Get-Process -Name '微信开发者工具'
3. 查看日志: automation/test-runs/<timestamp>/test.log
4. 查看截图: automation/test-runs/<timestamp>/screenshots/
5. 单步调试: 用 node -e "..." 直接连接并执行单个操作
```

---

## 三、整体 Workflow 逻辑（端到端）

### 3.1 端到端流程图

```
[启动]
  │
  ▼
[解析参数] ──── --file / --input ──── [加载查询条件数组]
  │
  ▼
[初始化运行目录] ──── test-runs/<timestamp>/
  │
  ▼
[连接 DevTools]
  ├── 检测端口 9420
  ├── 未监听 → cli.bat auto 启动
  ├── automator.connect()
  └── 等待小程序加载
  │
  ▼
[自动登录]
  ├── 导航到 phoneLogin
  ├── 填入手机号 + 验证码
  ├── 勾选协议 + 点击登录
  └── 验证跳转成功
  │
  ▼
┌──────────────────── 主循环 ────────────────────┐
│  for each query in queries:                     │
│    │                                            │
│    ▼                                            │
│  [导航到搜索页]                                  │
│    │                                            │
│    ▼                                            │
│  [打开筛选弹窗]                                  │
│    │                                            │
│    ▼                                            │
│  [填入筛选条件] ── position / company / edu ...  │
│    │                                            │
│    ▼                                            │
│  [提交匹配] ── sleep(15s) 等待结果               │
│    │                                            │
│    ▼                                            │
│  [判断结果] ── jobCount == 0? ── 是 → 跳过详情   │
│    │                                            │
│    ▼ 否                                         │
│  [点击第一个 .job-item]                          │
│    │                                            │
│    ▼                                            │
│  [等待跳转到 detail 页]                          │
│    │                                            │
│    ▼                                            │
│  [smoothScroll × 5 次]                          │
│    │  每次 300px，阻尼衰减，400-600ms            │
│    │                                            │
│    ▼                                            │
│  [返回搜索页] ── navigateBack / switchTab        │
│    │                                            │
│    ▼                                            │
│  [下一个 query] ────────────────────────────────┘
  │
  ▼
[完成] ── 日志输出 "DONE - all queries finished"
```

### 3.2 循环体核心步骤详解

#### Step 1: 数据获取

```javascript
const queries = JSON.parse(fs.readFileSync('test-queries.json'))
// queries = [
//   { "position": "Java开发", "education": "本科", "companyType": "央国企" },
//   { "position": "产品经理", "education": "硕士", "job_type": "全职" },
//   ...
// ]
```

#### Step 2: 筛选条件填入（约 3 秒）

```
填入顺序: position → company → education → companyType → job_type
每个操作间隔 500ms，避免 UI 响应不过来
```

#### Step 3: 搜索结果等待

```
点击"开始匹配" → sleep(15000ms) → 读取 .position-news 文本
为什么不使用 page.waitFor()? 因为 waitFor() 在某些查询下会无限挂起
```

#### Step 4: 岗位点击与详情页进入

```
关键发现: xtx-job-item (自定义组件) 的 tap 不会触发导航
           .job-item (内部 view 元素) 的 tap 才能正确跳转到 detail 页
```

#### Step 5: 滑动执行

`smoothScroll` 函数的数学模型：

```
参数: startY, endY, duration
模型: V_new = V_old × 0.95 (阻尼衰减)

帧循环 (16ms 间隔, ~60fps):
  frame 0:  sleep(50ms)                    ← 延迟起步
  frame 1:  velocity *= 0.95; y += velocity
  frame 2:  velocity *= 0.95; y += velocity
  ...
  frame N:  y >= endY → scrollTo(endY)
            sleep(100ms)                   ← touchend 静止等待
            resolve()

特性:
  - 开头快、结尾慢（阻尼感）
  - 50ms 延迟起步（模拟手指按下的准备时间）
  - 100ms touchend 后等待（页面惯性回弹静止）
```

### 3.3 循环终止条件与异常退出

| 条件 | 行为 |
|------|------|
| 所有查询执行完毕 | 输出 "DONE"，正常退出 |
| `jobCount == 0` | 跳过详情页步骤，直接下一个 query |
| 未进入 detail 页 | 输出 WARN，跳过滑动，执行 goBack |
| `scroll-view` 未找到 | 输出 WARN，跳过滑动 |
| 连接断开 / 致命错误 | 输出 FATAL，`process.exit(1)` |

### 3.4 重试与回退逻辑

**连接重试：**
```
connect() 最多重试 5 次，每次间隔 3 秒
startAutoMode() 最多等待 30 秒检测端口
```

**页面导航回退：**
```
goBack(mp):
  1. navigateBack() → 检查返回的 page.path
  2. 如果失败 → switchTab('/pages/position/search')
  3. 如果仍失败 → navigateTo('/pages/position/search')
```

**导航到搜索页回退：**
```
navigateToSearch(mp):
  1. switchTab('/pages/position/search')
  2. 失败 → navigateTo('/pages/position/search')
  3. 仍失败 → navigateBack() 后重试 navigateTo
```

---

## 附录

### A. 完整选择器清单

| 选择器 | 类型 | 用途 |
|--------|------|------|
| `.input` | InputElement | 登录页手机号/验证码输入 |
| `.agreement-checkbox` | Element | 用户协议勾选框 |
| `.code-btn` | Element | 获取验证码按钮 |
| `.form-button` | Element | 登录提交按钮 |
| `.filter-icon` | Element | 搜索页筛选入口 |
| `.input-field` | InputElement | 筛选弹窗文本输入 |
| `.option-btn` | Element | 筛选弹窗选项按钮 |
| `.confirm-btn` | Element | 开始匹配按钮 |
| `.position-news` | Element | 搜索结果统计文本 |
| `.job-item` | Element | 岗位卡片 (内部 view) |
| `scroll-view` | ScrollViewElement | 详情页可滚动容器 |

### B. 关键 API 参考

```javascript
// MiniProgram 类
mp.currentPage()           // 获取当前页面
mp.navigateTo(url)         // 跳转页面
mp.switchTab(url)          // 切换 Tab
mp.navigateBack()          // 返回上一页
mp.screenshot({ path })    // 截图

// Page 类
page.$(selector)           // 查找单个元素
page.$$(selector)          // 查找多个元素

// Element 类
el.tap()                   // 点击
el.input(value)            // 输入文本
el.text()                  // 获取文本

// ScrollViewElement 类
sv.scrollTo(x, y)          // 滚动到指定位置
sv.scrollHeight()          // 获取滚动高度
sv.size()                  // 获取尺寸
```

### C. smoothScroll 完整实现

```javascript
function smoothScroll(scrollview, startY, endY, duration) {
  return new Promise(async (resolve) => {
    const totalDistance = endY - startY
    const frameInterval = 16           // ~60fps
    const totalFrames = Math.ceil(duration / frameInterval)
    const dampingFactor = 0.95         // V_new = V_old * 0.95

    let velocity = totalDistance / totalFrames
    let currentY = startY
    let frame = 0

    await sleep(50)  // 延迟起步

    const tick = async () => {
      frame++
      velocity *= dampingFactor        // 阻尼衰减
      currentY += velocity

      if ((totalDistance > 0 && currentY >= endY) ||
          (totalDistance < 0 && currentY <= endY)) {
        currentY = endY
      }

      try { await scrollview.scrollTo(0, Math.round(currentY)) } catch {}

      if (frame < totalFrames && Math.abs(currentY - endY) > 0.5) {
        setTimeout(tick, frameInterval)
      } else {
        await sleep(100)               // touchend 静止等待
        resolve()
      }
    }
    tick()
  })
}
```
