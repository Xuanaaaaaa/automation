# 已知问题

## 1. 城市筛选只能选区域，不支持精确城市

**状态**: 已解决 ✅

**描述**: 筛选弹窗中"城市"区域只有区域选项（京津冀、江浙沪、川渝），没有单独的城市选项（如北京、上海）。当前实现默认选第一个区域按钮（京津冀）。

**影响**: 弹幕解析出的城市（如"北京"、"上海"）无法精确匹配，只能选到对应区域。

**解决方案**: 采用方案 3 - 在搜索页顶部的"意向城市"chip 处直接选择城市。

新增 `selectCity(mp, cityName)` 函数，流程：
1. 在搜索页点击 `.city-selector` 按钮
2. 跳转到 `pages/areaChoice/index` 城市选择页（省级-城市两级勾选器）
3. 在左栏找到目标省份（如"北京市"）并点击
4. 在右栏点击"全部选择"
5. 点击"保存"返回搜索页

`runOneCycle` 中在 `openFilter` 之前调用 `selectCity`，城市选择完成后才打开筛选弹窗填其他条件。

**注意事项**:
- 省份名带后缀（"北京市"不是"北京"），用 `startsWith` 匹配
- `bindtap` 直接在 `<text class="province-name">` 上，直接 `tap()` 即可
- 测试脚本: `test-city-select.js`

**相关代码**: `automation-core.js` → `selectCity()` + `runOneCycle()`
