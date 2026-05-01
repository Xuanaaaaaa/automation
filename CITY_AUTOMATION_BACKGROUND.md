# 微信小程序城市筛选自动化背景报告

## 任务目标

修复微信小程序自动化脚本中“城市筛选不稳定”的问题。

当前自动化用于监听弹幕 JSONL 查询事件，转成小程序筛选条件，然后通过微信官方 `miniprogram-automator` 控制微信开发者工具，在岗位搜索页自动筛选、匹配、浏览岗位。

## 当前代码位置

- `/Users/zhoukexuanmac/workspace/automation/watch-danmu.js`
- `/Users/zhoukexuanmac/workspace/automation/lib/automation-core.js`
- 跨平台运行配置文档：`/Users/zhoukexuanmac/workspace/automation/CROSS_PLATFORM_SETUP.md`

## 小程序项目位置

- 小程序项目根目录：`/Users/zhoukexuanmac/workspace/aibz`
- 当前 macOS DevTools 实际运行产物：`/Users/zhoukexuanmac/workspace/aibz/dist/build/mp-weixin`
- 旧报告中曾记录 `dist/dev/mp-weixin`，但当前环境已确认应使用 `dist/build/mp-weixin`。

## 连接修复进度

已经修复：

1. `automation-core.js` 在 macOS 上默认使用：
   - CLI：`/Applications/wechatwebdevtools.app/Contents/MacOS/cli`
   - 项目：`/Users/zhoukexuanmac/workspace/aibz/dist/build/mp-weixin`
   - 端口：`9420`
2. 启动 auto 模式前会校验：
   - CLI 是否存在。
   - 小程序项目路径是否存在。
   - `project.config.json` 是否存在。
3. macOS 下端口检测改用 `lsof -nP -iTCP:<port> -sTCP:LISTEN`，Windows 仍使用 `netstat/findstr`。
4. `miniprogram-automator` 依赖加载增加回退路径：
   - 当前仓库自身 `node_modules`。
   - 相邻小程序项目 `../aibz/node_modules/miniprogram-automator`。

已验证：

- 成功执行 `cli auto --project /Users/zhoukexuanmac/workspace/aibz/dist/build/mp-weixin --auto-port 9420 --trust-project`。
- `core.connect()` 可连接到 `ws://127.0.0.1:9420`。
- 当前页可通过 automator 读取，例如 `pages/position/search`。

## 当前自动化流程

1. `watch-danmu.js` 监听 `DANMU_JSONL_DIR` 下最新 JSONL 文件的新行。
2. `toAutomationCriteria()` 将弹幕记录转成自动化筛选条件：
   - `keyword -> position`
   - `query_payload.intention_company -> company`
   - `education -> education`
   - `query_payload.company_type -> companyType`
   - `query_payload.job_type -> job_type`
   - `city / intention_location -> city`
3. `watch-danmu.js` 会先调用 `normalizeCityName()` 归一化城市名，例如 `南京市 -> 南京`。
4. `runOneCycle()` 进入 `/pages/position/search`。
5. 打开 `.filter-icon` 筛选弹窗。
6. 填岗位、公司、学历、就业方向、工作性质等。
7. 如果有 `criteria.city`，调用 `selectCityInFilter()` 进入城市选择。
8. 点击 `.confirm-btn` 开始匹配。
9. 等待结果，点击岗位并尝试进入详情页滚动。

## 已修复的城市问题

原问题：

1. 靠下的省份/城市可能找不到。
2. 输入 `南京市` 时可能直接勾选 `江苏省` 复选框，导致全省城市被选中。
3. 筛选弹窗里多个“更多”可能点错，比如点到学历或岗位类型的“更多”。
4. 找不到具体城市时存在点击“全部选择”的危险兜底。

当前实现：

1. 城市名归一化：
   - 去空格。
   - 去 `市/省/自治区/自治州/地区/盟/林区` 等常见后缀。
   - `南京市 -> 南京`，`武汉市 -> 武汉`，`乌鲁木齐市 -> 乌鲁木齐`。
2. 城市到省份映射：
   - 优先读取当前小程序 build 产物中的 `services/home.js` 的 `APIareaList()`。
   - 读取失败时使用常见城市到省份的兜底映射。
3. 筛选弹窗入口：
   - 优先定位 `#locationPreference`。
   - 如果 id selector 不可靠，则遍历 `.option-section`，找文本以“城市”开头且内部有 `.more-link` 的 section。
   - 不再遍历页面所有“更多”。
4. areaChoice 页省份选择：
   - 左侧只点击 `.province-name`。
   - 不点击 `.province-checkbox`。
   - 通过 `.province-list` 滚动，每次滚动后重新查询 `.province-item`。
5. areaChoice 页城市选择：
   - 右侧跳过 `全部选择`。
   - 精确匹配归一化城市候选，例如 `南京` 和 `南京市`。
   - 通过 `.city-list` 滚动，每次滚动后重新查询 `.city-item`。
   - 如果城市已选中，不会再次点击，避免反选。
   - 如果当前省份处于“全部选择”，先取消全选，再精确勾目标城市。
6. 找不到具体城市时：
   - 不保存。
   - 不默认点“全部选择”。
   - 直接返回上一页，避免把省份或全部城市带进筛选条件。

## 已验证场景

真实 DevTools 自动化测试已跑过：

1. `南京，产品经理，本科`
   - 城市流程：`南京 -> 江苏省 -> 南京市`
   - 查询结果：`已为你查询到16个岗位`
   - 已进入第一个岗位详情页并完成滚动，最后返回搜索页。
2. `武汉，产品经理，本科`
   - 城市流程：`武汉 -> 湖北省 -> 武汉市`
   - 查询结果：`已为你查询到12个岗位`
   - 已进入第一个岗位详情页并完成滚动，最后返回搜索页。
3. `乌鲁木齐市`
   - 城市流程：`乌鲁木齐市 -> 新疆维吾尔自治区 -> 乌鲁木齐市`
   - 用于验证靠下省份/城市映射和精确选择逻辑。

语法检查已通过：

```bash
node --check lib/automation-core.js
node --check watch-danmu.js
```

## 关键小程序产物位置

当前应优先参考 build 产物：

- 搜索页 WXML：`/Users/zhoukexuanmac/workspace/aibz/dist/build/mp-weixin/pages/position/search.wxml`
- 筛选弹窗 WXML：`/Users/zhoukexuanmac/workspace/aibz/dist/build/mp-weixin/components/FilterPosition.wxml`
- 筛选弹窗 JS：`/Users/zhoukexuanmac/workspace/aibz/dist/build/mp-weixin/components/FilterPosition.js`
- 城市选择页 WXML：`/Users/zhoukexuanmac/workspace/aibz/dist/build/mp-weixin/pages/areaChoice/index.wxml`
- 地区数据来源：`/Users/zhoukexuanmac/workspace/aibz/dist/build/mp-weixin/services/home.js`

注意：源码中页面归属可能与编译产物不一致。当前阶段自动化脚本只修改 `/Users/zhoukexuanmac/workspace/automation` 仓库，不修改小程序源码。

## 后续可调整方向

1. 增加更多真实弹幕样例回放测试，例如 `上海 Java 本科`、`成都 产品经理 硕士`。
2. 给 watcher 增加 dry-run 模式，只打印从弹幕转换出的 criteria，不操作 UI。
3. 将城市选择核心 helper 暴露为测试入口，写更小的单元测试。
4. 如果要长期兼容 Windows/macOS，建议继续维护 `CROSS_PLATFORM_SETUP.md` 并把 README/USAGE 中的旧 Windows 路径同步更新。
5. 可以增加“运行前清空旧筛选条件”的策略，避免连续多条弹幕之间互相残留。

## 新对话提示词

可以在另一个对话窗口使用下面这段提示词继续推进：

```text
请继续维护 /Users/zhoukexuanmac/workspace/automation 里的微信小程序自动化脚本。

背景：脚本通过 miniprogram-automator 控制微信开发者工具，监听弹幕 JSONL 后在小程序岗位搜索页自动填写筛选条件并浏览岗位。当前 macOS 小程序产物路径是 /Users/zhoukexuanmac/workspace/aibz/dist/build/mp-weixin，DevTools CLI 是 /Applications/wechatwebdevtools.app/Contents/MacOS/cli，auto 端口默认 9420。跨平台配置文档在 CROSS_PLATFORM_SETUP.md。

当前已完成：
1. 修正 macOS 连接路径和 auto 模式启动/检测逻辑。
2. 城市名归一化，例如 南京市->南京、武汉市->武汉。
3. 从 build 产物 services/home.js 的 APIareaList() 建立城市到省份映射。
4. 筛选弹窗城市入口限定为城市 section 的“更多”，避免点到学历/岗位类型的“更多”。
5. areaChoice 页左侧只点 .province-name，不点省份复选框。
6. 省份和城市都支持滚动查找。
7. 右侧精确勾选城市，跳过“全部选择”；找不到具体城市时不保存，不全选省份。
8. 已真实验证 南京/产品经理/本科 和 武汉/产品经理/本科 均可正常跑完。

请先阅读 CITY_AUTOMATION_BACKGROUND.md、CROSS_PLATFORM_SETUP.md、watch-danmu.js 和 lib/automation-core.js。接下来我想继续优化：为 watcher 增加 dry-run/单条弹幕回放能力，并补充更多城市与筛选条件的自动化回归测试。请先给出最小改动方案，再实现并用微信开发者工具或本地命令验证。
```
