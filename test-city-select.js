/**
 * test-city-select.js
 * 测试城市精确选择流程：筛选弹窗 → 更多 → areaChoice 页面 → 选城市 → 保存
 *
 * 用法：node automation/test-city-select.js [城市名]
 * 默认测试城市：北京
 */

const path = require('path')
const {
  initLogging, log, sleep, screenshot,
  connect, ensureLoggedIn,
  navigateToSearch,
  TIMEOUTS,
} = require('./lib/automation-core')

const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const RUN_DIR = path.join(__dirname, 'test-runs', `city-select-${RUN_ID}`)
const TARGET_CITY = process.argv[2] || '北京'

async function main() {
  initLogging(RUN_DIR)
  log('========================================')
  log(`城市选择测试: 目标城市="${TARGET_CITY}"`)
  log(`运行目录: ${RUN_DIR}`)
  log('========================================')

  // 1. 连接（已登录则跳过登录）
  const mp = await connect()
  const startPage = await mp.currentPage()
  if (startPage.path.includes('login')) {
    await ensureLoggedIn(mp)
  } else {
    log(`[login] 已登录，当前页面: ${startPage.path}，跳过登录`)
  }

  // 2. 用 reLaunch 导航到搜索页（清理 webview 栈）
  log('[step] 导航到搜索页...')
  await mp.reLaunch('/pages/position/search')
  await sleep(TIMEOUTS.PAGE_LOAD + 1000)
  let page = await mp.currentPage()
  log(`  当前页面: ${page.path}`)
  await screenshot(mp, '1-search-page')

  // 3. 点击搜索页顶部的"城市"选择器（.city-selector）
  log('[step] 点击城市选择器...')
  const citySelector = await page.$('.city-selector')
  if (!citySelector) {
    log('  FAIL: 找不到 .city-selector 按钮')
    return
  }
  await citySelector.tap()
  log('  OK 已点击城市选择器')
  await sleep(TIMEOUTS.PAGE_LOAD + 1000)

  // 5. 等待 areaChoice 页面加载
  log('[step] 等待城市选择页加载...')
  let areaPage = await mp.currentPage()
  log(`  当前页面: ${areaPage.path}`)

  // 如果 tap 没有触发导航，直接用 navigateTo
  if (!areaPage.path.includes('areaChoice')) {
    log('  [WARN] tap 未触发导航，尝试 mp.navigateTo...')
    try {
      await mp.navigateTo('/pages/areaChoice/index')
      await sleep(TIMEOUTS.PAGE_LOAD + 1000)
      areaPage = await mp.currentPage()
      log(`  navigateTo 后: ${areaPage.path}`)
    } catch (e) {
      log(`  navigateTo 失败: ${e.message}`)
    }
  }
  await screenshot(mp, '2-area-choice-page')

  // 6. 在左栏找到目标省份并点击
  log(`[step] 查找省份: ${TARGET_CITY}...`)
  const provinceItems = await areaPage.$$('.province-item .province-name')
  log(`  找到 ${provinceItems.length} 个省份`)

  let provinceFound = false
  for (let i = 0; i < provinceItems.length; i++) {
    try {
      const text = await provinceItems[i].text()
      // 省份名带后缀：北京市、天津市、河北省 等
      if (text === TARGET_CITY || text.startsWith(TARGET_CITY)) {
        await provinceItems[i].tap()
        log(`  OK 点击省份: ${text}`)
        provinceFound = true
        await sleep(TIMEOUTS.FILTER_FILL_GAP)
        break
      }
    } catch {}
  }

  if (!provinceFound) {
    log(`  FAIL: 找不到省份 "${TARGET_CITY}"`)
    await screenshot(mp, '2-error-no-province')
    return
  }
  await screenshot(mp, '3-province-selected')

  // 7. 在右栏点击"全部选择"
  log('[step] 点击"全部选择"...')
  const cityItems = await areaPage.$$('.city-item')
  log(`  找到 ${cityItems.length} 个城市/选项`)

  let selectAllFound = false
  for (const item of cityItems) {
    try {
      const nameEl = await item.$('.city-name')
      if (nameEl) {
        const text = await nameEl.text()
        if (text === '全部选择') {
          await item.tap()
          log('  OK 点击"全部选择"')
          selectAllFound = true
          await sleep(TIMEOUTS.FILTER_FILL_GAP)
          break
        }
      }
    } catch {}
  }

  if (!selectAllFound) {
    log('  [WARN] 找不到"全部选择"，尝试点击第一个城市...')
    if (cityItems.length > 0) {
      await cityItems[0].tap()
      log('  OK 点击第一个城市项')
      await sleep(TIMEOUTS.FILTER_FILL_GAP)
    }
  }
  await screenshot(mp, '4-city-selected')

  // 8. 点击"保存"
  log('[step] 点击"保存"...')
  const saveBtn = await areaPage.$('.save-btn')
  if (!saveBtn) {
    log('  FAIL: 找不到"保存"按钮')
    await screenshot(mp, '4-error-no-save')
    return
  }
  await saveBtn.tap()
  log('  OK 保存按钮已点击')
  await sleep(TIMEOUTS.NAV_BACK_WAIT)

  // 9. 验证返回搜索页
  let currentPage = await mp.currentPage()
  log(`[verify] 当前页面: ${currentPage.path}`)

  if (currentPage.path.includes('position/search')) {
    log('[verify] OK 已返回搜索页')
  } else {
    log(`  [WARN] 未返回搜索页，尝试 reLaunch...`)
    await mp.reLaunch('/pages/position/search')
    await sleep(TIMEOUTS.PAGE_LOAD)
    currentPage = await mp.currentPage()
    log(`  reLaunch 后: ${currentPage.path}`)
  }
  await screenshot(mp, '5-back-to-search')

  log('========================================')
  log('测试完成')
  log('========================================')
}

main().catch(err => {
  console.error('FATAL:', err.message)
  process.exit(1)
})
