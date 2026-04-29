/**
 * automation-core.js
 * 从 loop-search.js 提取的共享函数，供 loop-search.js 和 watch-danmu.js 共用。
 * - 配置从环境变量读取（向后兼容硬编码默认值）
 * - 日志路径通过 initLogging() 注入
 * - require() 时无副作用
 */

const automator = require('miniprogram-automator')
const cp = require('child_process')
const fs = require('fs')
const path = require('path')

// ── Config（环境变量优先，硬编码兜底）──────────────────────────────
const CLI_PATH = process.env.WECHAT_DEVTOOLS_CLI || 'D:/software/微信web开发者工具/cli.bat'
const PROJECT_PATH = process.env.WECHAT_MINIPROGRAM_PROJECT || 'D:/aibz/dist/dev/mp-weixin'
const AUTO_PORT = parseInt(process.env.WECHAT_AUTO_PORT || '9420', 10)
const PHONE_NUMBER = '91231231234'
const VERIFY_CODE = '1111'

const TIMEOUTS = {
  PAGE_LOAD: 3000,
  FILTER_FILL_GAP: 500,
  RESULT_WAIT: 15000,
  DETAIL_STAY: 3000,
  SCROLL_INTERVAL: 2000,
  SCROLL_COUNT: 5,
  NAV_BACK_WAIT: 2000,
  ELEMENT_WAIT: 10000,
  CONNECT_RETRY: 5,
  CONNECT_RETRY_DELAY: 2000,
  AUTO_LAUNCH_TIMEOUT: 30000,
}

// ── 可注入的日志状态 ─────────────────────────────────────────────
let _logFile = null
let _screenshotDir = null

/**
 * 初始化日志目录。必须在调用 log() / screenshot() 之前调用。
 * @param {string} runDir - 本轮运行的目录（会自动创建 screenshots 子目录）
 */
function initLogging(runDir) {
  _screenshotDir = path.join(runDir, 'screenshots')
  _logFile = path.join(runDir, 'test.log')
  fs.mkdirSync(_screenshotDir, { recursive: true })
}

// ── Utilities ──────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function log(msg) {
  const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false })
  const line = `[${ts}] ${msg}`
  console.log(line)
  if (_logFile) {
    fs.appendFileSync(_logFile, line + '\n')
  }
}

async function screenshot(mp, label) {
  if (!_screenshotDir) return
  const filePath = path.join(_screenshotDir, `${label}.png`)
  try {
    await mp.screenshot({ path: filePath })
    log(`  [screenshot] ${label}`)
  } catch (e) {
    log(`  [WARN] screenshot failed: ${e.message}`)
  }
}

// ── Smooth scroll with damping ───────────────────────────────────
function smoothScroll(scrollview, startY, endY, duration) {
  return new Promise(async (resolve) => {
    const totalDistance = endY - startY
    const frameInterval = 16
    const totalFrames = Math.ceil(duration / frameInterval)
    const dampingFactor = 0.95

    let velocity = totalDistance / totalFrames
    let currentY = startY
    let frame = 0

    await sleep(50)

    const tick = async () => {
      frame++
      velocity *= dampingFactor
      currentY += velocity

      if ((totalDistance > 0 && currentY >= endY) || (totalDistance < 0 && currentY <= endY)) {
        currentY = endY
      }

      try {
        await scrollview.scrollTo(0, Math.round(currentY))
      } catch {}

      if (frame < totalFrames && Math.abs(currentY - endY) > 0.5) {
        setTimeout(tick, frameInterval)
      } else {
        await sleep(100)
        resolve()
      }
    }
    tick()
  })
}

// ── Connect ──────────────────────────────────────────────────────

function isPortListening(port) {
  try {
    const result = cp.execSync(`netstat -ano | findstr ":${port}" | findstr "LISTENING"`, { encoding: 'utf-8' })
    return result.trim().length > 0
  } catch {
    return false
  }
}

async function startAutoMode() {
  if (isPortListening(AUTO_PORT)) {
    log(`[connect] 端口 ${AUTO_PORT} 已在监听，跳过启动`)
    return
  }

  log(`[connect] 端口 ${AUTO_PORT} 未检测到，启动 auto 模式...`)
  try {
    cp.execSync(`"${CLI_PATH}" auto --project "${PROJECT_PATH}" --auto-port ${AUTO_PORT}`, {
      timeout: TIMEOUTS.AUTO_LAUNCH_TIMEOUT,
      stdio: 'pipe'
    })
  } catch (e) {
    log(`[connect] cli auto 返回: ${e.status || e.message}`)
  }

  for (let i = 0; i < 15; i++) {
    if (isPortListening(AUTO_PORT)) {
      log(`[connect] 端口 ${AUTO_PORT} 就绪`)
      return
    }
    await sleep(2000)
  }
  throw new Error(`端口 ${AUTO_PORT} 启动超时`)
}

async function connect() {
  log('[connect] 连接开发者工具...')
  await startAutoMode()

  const maxRetries = 5
  for (let i = 1; i <= maxRetries; i++) {
    try {
      log(`[connect] 尝试连接 ${i}/${maxRetries}`)
      const mp = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${AUTO_PORT}` })
      log('[connect] OK - 已连接')

      for (let j = 0; j < 10; j++) {
        try {
          const page = await mp.currentPage()
          if (page && page.path) {
            log(`[connect] 小程序就绪: ${page.path}`)
            return mp
          }
        } catch {}
        await sleep(2000)
      }
      log('[connect] [WARN] 小程序可能未完全加载')
      return mp
    } catch (e) {
      log(`[connect] 连接失败: ${e.message}`)
      if (i < maxRetries) await sleep(3000)
    }
  }

  throw new Error('无法连接到开发者工具')
}

// ── Auto login ──────────────────────────────────────────────────────

async function ensureLoggedIn(mp) {
  const page = await mp.currentPage()
  log(`[login] current page: ${page.path}`)

  let loginPage
  if (page.path.includes('phoneLogin')) {
    loginPage = page
  } else if (page.path.includes('login')) {
    log('[login] on login page, navigating to phoneLogin...')
    loginPage = await mp.navigateTo('/pages/login/phoneLogin')
    await sleep(TIMEOUTS.PAGE_LOAD)
  } else {
    log('[login] navigating to login page...')
    loginPage = await mp.navigateTo('/pages/login/phoneLogin')
    await sleep(TIMEOUTS.PAGE_LOAD)
  }
  await screenshot(mp, '0-login-page')

  const inputs = await loginPage.$$('.input')
  log(`[login] found ${inputs.length} input fields`)

  if (inputs[0]) {
    await inputs[0].input(PHONE_NUMBER)
    log(`[login] phone number filled: ${PHONE_NUMBER}`)
    await sleep(800)
  }

  try {
    const checkbox = await loginPage.$('.agreement-checkbox')
    if (checkbox) {
      await checkbox.tap()
      log('[login] user agreement checked')
      await sleep(800)
    } else {
      log('[login] [WARN] agreement checkbox not found')
    }
  } catch (e) {
    log(`[login] [WARN] check agreement failed: ${e.message}`)
  }

  try {
    const codeBtn = await loginPage.$('.code-btn')
    if (codeBtn) {
      await codeBtn.tap()
      log('[login] verification code requested')
      await sleep(2000)
    }
  } catch (e) {
    log(`[login] [WARN] send code failed: ${e.message}`)
  }

  await screenshot(mp, '0-login-code-sent')

  const freshInputs = await loginPage.$$('.input')
  if (freshInputs[1]) {
    await freshInputs[1].input(VERIFY_CODE)
    log(`[login] verification code filled: ${VERIFY_CODE}`)
    await sleep(800)
  }

  await screenshot(mp, '0-login-form-filled')

  try {
    const loginBtn = await loginPage.$('.form-button')
    if (loginBtn) {
      await loginBtn.tap()
      log('[login] login button tapped')
      await sleep(3000)
    }
  } catch (e) {
    log(`[login] [WARN] tap login failed: ${e.message}`)
  }

  const currentPage = await mp.currentPage()
  log(`[login] after login, current page: ${currentPage.path}`)

  if (currentPage.path.includes('login')) {
    log('[login] [WARN] still on login page, login may have failed')
  } else {
    log('[login] OK login complete')
  }

  await screenshot(mp, '0-login-result')
}

// ── Actions ─────────────────────────────────────────────────────────

async function navigateToSearch(mp) {
  log('[step] 导航到搜索页...')

  let page
  try {
    page = await mp.switchTab('/pages/position/search')
  } catch {
    try {
      page = await mp.navigateTo('/pages/position/search')
    } catch {
      log('  navigateTo 失败，尝试返回后重试...')
      await mp.navigateBack()
      await sleep(TIMEOUTS.PAGE_LOAD)
      page = await mp.navigateTo('/pages/position/search')
    }
  }
  await sleep(TIMEOUTS.PAGE_LOAD)
  log(`  OK search page loaded, path: ${page.path}`)
  return page
}

async function openFilter(page) {
  log('[step] 打开筛选弹窗...')
  const filterBtn = await page.$('.filter-icon')
  if (!filterBtn) throw new Error('筛选按钮未找到 (.filter-icon)')
  await filterBtn.tap()
  await page.waitFor('.confirm-btn', TIMEOUTS.ELEMENT_WAIT)
  await sleep(TIMEOUTS.FILTER_FILL_GAP)
  log('  OK filter modal opened')
}

async function fillFilters(page, criteria) {
  log(`[step] 填入筛选条件: ${JSON.stringify(criteria)}`)

  const inputs = await page.$$('.input-field')
  log(`  找到 ${inputs.length} 个输入框`)

  // inputs[0] = position
  if (criteria.position && inputs[0]) {
    await inputs[0].input(criteria.position)
    log(`  OK position: ${criteria.position}`)
    await sleep(TIMEOUTS.FILTER_FILL_GAP)
  }
  // inputs[2] = company
  if (criteria.company && inputs[2]) {
    await inputs[2].input(criteria.company)
    log(`  OK company: ${criteria.company}`)
    await sleep(TIMEOUTS.FILTER_FILL_GAP)
  }

  const optionBtns = await page.$$('.option-btn')
  log(`  找到 ${optionBtns.length} 个选项按钮`)

  // 非城市选项：education / companyType / job_type
  const targetKeys = ['education', 'companyType', 'job_type']
  for (const key of targetKeys) {
    const target = criteria[key]
    if (!target) continue
    for (const btn of optionBtns) {
      try {
        const text = await btn.text()
        if (text === target) {
          await btn.tap()
          log(`  OK selected: ${target}`)
          await sleep(TIMEOUTS.FILTER_FILL_GAP)
          break
        }
      } catch { /* skip stale btn ref */ }
    }
  }

  // 城市选项：筛选弹窗中城市区域是 option-btn，选项为 不限/京津冀/江浙沪/川渝
  // 注意：每个 section 都有"不限"，所以用城市独有的区域名来定位
  // TODO: 当前只选第一个区域，后续需要支持精确城市映射
  if (criteria.city) {
    const cityRegionBtns = ['京津冀', '江浙沪', '川渝']
    let clicked = false
    for (const btn of optionBtns) {
      try {
        const text = await btn.text()
        if (cityRegionBtns.includes(text)) {
          await btn.tap()
          log(`  OK city region: ${text} (for ${criteria.city})`)
          await sleep(TIMEOUTS.FILTER_FILL_GAP)
          clicked = true
          break
        }
      } catch {}
    }
    if (!clicked) {
      // 兜底：选"不限"
      for (const btn of optionBtns) {
        try {
          const text = await btn.text()
          if (text === '不限') {
            await btn.tap()
            log(`  OK city: 不限 (fallback)`)
            await sleep(TIMEOUTS.FILTER_FILL_GAP)
            break
          }
        } catch {}
      }
    }
  }
}

async function submitMatch(page) {
  log('[step] 提交匹配...')
  const confirmBtn = await page.$('.confirm-btn')
  if (!confirmBtn) throw new Error('开始匹配按钮未找到 (.confirm-btn)')
  await confirmBtn.tap()
  log('  OK match button clicked')

  await sleep(TIMEOUTS.RESULT_WAIT)

  let resultText = ''
  try {
    const resultEl = await page.$('.position-news')
    if (resultEl) resultText = await resultEl.text()
  } catch {}
  log(`  [result] ${resultText || 'none'}`)

  const jobItems = await page.$$('xtx-job-item')
  log(`  [result] job items: ${jobItems.length}`)

  return { resultText, jobCount: jobItems.length }
}

async function enterJobAndScroll(mp, page, cycleIndex) {
  log('[step] 点击第一个岗位...')
  const jobItems = await page.$$('.job-item')
  if (jobItems.length === 0) {
    log('  [WARN] no job items to click')
    return
  }

  await jobItems[0].tap()
  log('  tapped first job item')
  await sleep(TIMEOUTS.PAGE_LOAD + 2000)

  let currentPage = await mp.currentPage()
  if (!currentPage) {
    log('  [WARN] cannot get current page')
    return
  }

  if (!currentPage.path.includes('position/detail')) {
    log(`  [WARN] not on detail page, current: ${currentPage.path}`)
    return
  }

  log(`  OK detail page entered: ${currentPage.path}`)

  log(`[step] scroll: ${TIMEOUTS.DETAIL_STAY / 1000}s stay + ${TIMEOUTS.SCROLL_COUNT} swipes`)
  await sleep(TIMEOUTS.DETAIL_STAY)
  await screenshot(mp, `${cycleIndex + 1}-detail-top`)

  const scrollview = await currentPage.$('scroll-view')
  if (!scrollview) {
    log('  [WARN] scroll-view not found on detail page')
    return
  }

  let currentY = 0
  for (let i = 0; i < TIMEOUTS.SCROLL_COUNT; i++) {
    const targetY = currentY + 300 + Math.round((Math.random() - 0.5) * 40)
    const duration = 400 + Math.floor(Math.random() * 200)
    log(`  swipe ${i + 1}/${TIMEOUTS.SCROLL_COUNT} ${currentY} -> ${targetY} (${duration}ms)`)
    await smoothScroll(scrollview, currentY, targetY, duration)
    currentY = targetY
    await sleep(TIMEOUTS.SCROLL_INTERVAL + Math.floor(Math.random() * 500))
  }
  await screenshot(mp, `${cycleIndex + 1}-detail-scrolled`)
  log('  OK scroll done')
}

async function goBack(mp) {
  log('[step] 返回搜索页...')
  try {
    const page = await mp.navigateBack()
    await sleep(TIMEOUTS.NAV_BACK_WAIT)
    if (page) {
      log(`  OK navigated back, path: ${page.path}`)
      return
    }
  } catch {
    log('  [WARN] navigateBack failed')
  }

  log('  trying switchTab to search page...')
  try {
    await mp.switchTab('/pages/position/search')
    await sleep(TIMEOUTS.PAGE_LOAD)
    log('  OK back to search page')
  } catch {
    log('  [WARN] switchTab also failed, trying navigateTo')
    try {
      await mp.navigateTo('/pages/position/search')
      await sleep(TIMEOUTS.PAGE_LOAD)
    } catch {
      log('  FAIL cannot return to search page')
    }
  }
}

// ── Single Cycle ────────────────────────────────────────────────────

async function runOneCycle(mp, criteria, index) {
  const tag = `[${index + 1}]`
  log(`\n${'='.repeat(50)}`)
  log(`${tag} 开始处理: ${JSON.stringify(criteria)}`)
  log(`${'='.repeat(50)}`)

  try {
    const page = await navigateToSearch(mp)

    await openFilter(page)
    await fillFilters(page, criteria)
    await screenshot(mp, `${index + 1}-filter`)

    const { resultText, jobCount } = await submitMatch(page)
    await screenshot(mp, `${index + 1}-result`)

    if (jobCount === 0) {
      log(`${tag} no results, skipping detail step`)
      return
    }

    await enterJobAndScroll(mp, page, index)
    await goBack(mp)

    log(`${tag} OK cycle done`)
  } catch (err) {
    log(`${tag} FAIL cycle error: ${err.message}`)
    try { await screenshot(mp, `${index + 1}-error`) } catch {}
  }
}

// ── Exports ─────────────────────────────────────────────────────────

module.exports = {
  initLogging,
  sleep,
  log,
  screenshot,
  smoothScroll,
  connect,
  ensureLoggedIn,
  navigateToSearch,
  openFilter,
  fillFilters,
  submitMatch,
  enterJobAndScroll,
  goBack,
  runOneCycle,
  TIMEOUTS,
}
