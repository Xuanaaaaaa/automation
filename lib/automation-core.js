/**
 * automation-core.js
 * 从 loop-search.js 提取的共享函数，供 loop-search.js 和 watch-danmu.js 共用。
 * - 配置从环境变量读取（向后兼容硬编码默认值）
 * - 日志路径通过 initLogging() 注入
 * - require() 时无副作用
 */

const cp = require('child_process')
const fs = require('fs')
const path = require('path')
const { readConfigValue, applyNoProxyConfig } = require('./local-config')

// ── Config（环境变量优先，硬编码兜底）──────────────────────────────
applyNoProxyConfig()

const DEFAULT_CLI_PATH = process.platform === 'darwin'
  ? '/Applications/wechatwebdevtools.app/Contents/MacOS/cli'
  : 'D:/software/微信web开发者工具/cli.bat'
const DEFAULT_PROJECT_PATH = process.platform === 'darwin'
  ? path.resolve(__dirname, '../../aibz/dist/build/mp-weixin')
  : 'D:/aibz/dist/dev/mp-weixin'
const CLI_PATH = readConfigValue('WECHAT_DEVTOOLS_CLI', ['wechatDevtoolsCli', 'WECHAT_DEVTOOLS_CLI'], DEFAULT_CLI_PATH)
const PROJECT_PATH = readConfigValue('WECHAT_MINIPROGRAM_PROJECT', ['wechatMiniprogramProject', 'WECHAT_MINIPROGRAM_PROJECT'], DEFAULT_PROJECT_PATH)
const AUTO_PORT = parseInt(readConfigValue('WECHAT_AUTO_PORT', ['wechatAutoPort', 'WECHAT_AUTO_PORT'], '9420'), 10)
const PHONE_NUMBER = '91231231234'
const VERIFY_CODE = '1111'

function loadAutomator() {
  try {
    return require('miniprogram-automator')
  } catch (e) {
    const fallbackRoots = [
      path.resolve(PROJECT_PATH, '../../../node_modules/miniprogram-automator'),
      path.resolve(__dirname, '../../aibz/node_modules/miniprogram-automator'),
    ]

    for (const fallback of fallbackRoots) {
      try {
        return require(fallback)
      } catch {
        // Keep looking. The automation repo may live beside the mini program repo.
      }
    }

    throw e
  }
}

const automator = loadAutomator()

const TIMEOUTS = {
  PAGE_LOAD: 3000,
  FILTER_FILL_GAP: 500,
  RESULT_WAIT: 5000,
  DETAIL_STAY: 3000,
  SCROLL_INTERVAL: 2000,
  SCROLL_COUNT: 3,
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

// ── City normalization ─────────────────────────────────────────────

const FALLBACK_CITY_TO_PROVINCE = {
  北京: '北京市',
  上海: '上海市',
  天津: '天津市',
  重庆: '重庆市',
  广州: '广东省',
  深圳: '广东省',
  成都: '四川省',
  杭州: '浙江省',
  南京: '江苏省',
  武汉: '湖北省',
  西安: '陕西省',
  长沙: '湖南省',
  苏州: '江苏省',
  郑州: '河南省',
  青岛: '山东省',
  大连: '辽宁省',
  厦门: '福建省',
  合肥: '安徽省',
  昆明: '云南省',
  贵阳: '贵州省',
  南昌: '江西省',
  太原: '山西省',
  石家庄: '河北省',
  哈尔滨: '黑龙江省',
  长春: '吉林省',
  沈阳: '辽宁省',
  兰州: '甘肃省',
  乌鲁木齐: '新疆维吾尔自治区',
  拉萨: '西藏自治区',
  呼和浩特: '内蒙古自治区',
  南宁: '广西壮族自治区',
  银川: '宁夏回族自治区',
  西宁: '青海省',
  海口: '海南省',
}

let _areaIndex = null

function normalizeAreaText(value) {
  if (Array.isArray(value)) value = value[0]
  return String(value || '')
    .trim()
    .replace(/[ \t\r\n　]/g, '')
    .replace(/^(中国|中华人民共和国)/, '')
    .replace(/[，,、;；/].*$/, '')
}

function normalizeAreaKey(value) {
  let text = normalizeAreaText(value)
  if (!text) return ''

  const suffixes = [
    '维吾尔自治区',
    '壮族自治区',
    '回族自治区',
    '特别行政区',
    '自治州',
    '自治区',
    '地区',
    '林区',
    '盟',
    '省',
    '市',
  ]

  let changed = true
  while (changed) {
    changed = false
    for (const suffix of suffixes) {
      if (text.length > suffix.length && text.endsWith(suffix)) {
        text = text.slice(0, -suffix.length)
        changed = true
        break
      }
    }
  }

  return text
}

function normalizeCityName(value) {
  return normalizeAreaKey(value)
}

function normalizeGraduateTime(value, currentYear = new Date().getFullYear()) {
  const text = String(value ?? '').trim()
  if (!text || text === '不限') return ''
  if (text === '往届') return '往届'

  const yearMatch = text.match(/^(?:20)?(\d{2})(?:届|年)?$/)
  if (!yearMatch) return text

  const year = Number(`20${yearMatch[1]}`)
  if (!Number.isFinite(year)) return text

  return year <= currentYear - 2 ? '往届' : String(year)
}

function graduateTimeLabel(value) {
  const normalized = normalizeGraduateTime(value)
  if (!normalized) return '不限'
  if (normalized === '往届') return '往届'
  if (/^\d{4}$/.test(normalized)) return `${normalized.slice(-2)}届`
  return normalized
}

function filterOptionCandidates(key, value) {
  if (key === 'graduate_time') {
    const normalized = normalizeGraduateTime(value)
    return [...new Set([graduateTimeLabel(normalized), normalized, value].filter(Boolean).map(String))]
  }

  if (key === 'education' && value === '大专') {
    return ['专科', '大专']
  }

  return [String(value)]
}

function addAreaLookup(map, key, value) {
  const raw = normalizeAreaText(key)
  const normalized = normalizeAreaKey(key)
  if (raw) map.set(raw, value)
  if (normalized) map.set(normalized, value)
}

function loadAreaList() {
  const candidates = [
    path.join(PROJECT_PATH, 'services/home.js'),
    path.resolve(__dirname, '../../aibz/dist/build/mp-weixin/services/home.js'),
    path.resolve(__dirname, '../../aibz/dist/dev/mp-weixin/services/home.js'),
  ]

  for (const filePath of candidates) {
    try {
      if (!fs.existsSync(filePath)) continue
      const mod = require(filePath)
      const result = typeof mod.APIareaList === 'function' ? mod.APIareaList() : null
      if (result && Array.isArray(result.data)) return result.data
    } catch {
      // Static area data is a helper. Runtime UI selection can still proceed.
    }
  }

  return []
}

function getAreaIndex() {
  if (_areaIndex) return _areaIndex

  const cityToProvince = new Map()
  const canonicalCity = new Map()
  const canonicalProvince = new Map()

  for (const [city, province] of Object.entries(FALLBACK_CITY_TO_PROVINCE)) {
    addAreaLookup(cityToProvince, city, province)
    addAreaLookup(canonicalCity, city, city.endsWith('市') ? city : `${city}市`)
  }

  for (const province of loadAreaList()) {
    if (!province || !province.name) continue
    addAreaLookup(canonicalProvince, province.name, province.name)

    const cities = Array.isArray(province.children) && province.children.length > 0
      ? province.children
      : [{ name: province.name }]

    for (const city of cities) {
      if (!city || !city.name) continue
      addAreaLookup(cityToProvince, city.name, province.name)
      addAreaLookup(canonicalCity, city.name, city.name)
    }
  }

  _areaIndex = { cityToProvince, canonicalCity, canonicalProvince }
  return _areaIndex
}

function areaMatches(actual, candidates) {
  const raw = normalizeAreaText(actual)
  const normalized = normalizeAreaKey(actual)

  for (const candidate of candidates) {
    if (!candidate) continue
    const candidateRaw = normalizeAreaText(candidate)
    const candidateNormalized = normalizeAreaKey(candidate)
    if (raw && candidateRaw && raw === candidateRaw) return true
    if (normalized && candidateNormalized && normalized === candidateNormalized) return true
  }

  return false
}

function makeCitySelectionPlan(cityName) {
  const raw = normalizeAreaText(cityName)
  const normalized = normalizeAreaKey(cityName)
  const { cityToProvince, canonicalCity, canonicalProvince } = getAreaIndex()

  const cityCandidates = [
    raw,
    normalized,
    normalized && `${normalized}市`,
    canonicalCity.get(raw),
    canonicalCity.get(normalized),
    canonicalCity.get(normalized && `${normalized}市`),
  ].filter(Boolean)

  const targetProvince =
    cityToProvince.get(raw) ||
    cityToProvince.get(normalized) ||
    cityToProvince.get(normalized && `${normalized}市`) ||
    canonicalProvince.get(raw) ||
    canonicalProvince.get(normalized)

  const provinceCandidates = [
    targetProvince,
    raw,
    normalized,
  ].filter(Boolean)

  return {
    raw,
    normalized,
    targetProvince,
    cityCandidates: [...new Set(cityCandidates)],
    provinceCandidates: [...new Set(provinceCandidates)],
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
    const command = process.platform === 'win32'
      ? `netstat -ano | findstr ":${port}" | findstr "LISTENING"`
      : `lsof -nP -iTCP:${port} -sTCP:LISTEN`
    const result = cp.execSync(command, { encoding: 'utf-8' })
    return result.trim().length > 0
  } catch {
    return false
  }
}

async function startAutoMode() {
  log(`[connect] CLI: ${CLI_PATH}`)
  log(`[connect] project: ${PROJECT_PATH}`)
  log(`[connect] port: ${AUTO_PORT}`)

  if (!fs.existsSync(CLI_PATH)) {
    throw new Error(`微信开发者工具 CLI 不存在: ${CLI_PATH}`)
  }
  if (!fs.existsSync(PROJECT_PATH)) {
    throw new Error(`小程序项目路径不存在: ${PROJECT_PATH}`)
  }
  if (!fs.existsSync(path.join(PROJECT_PATH, 'project.config.json'))) {
    throw new Error(`小程序项目配置不存在: ${path.join(PROJECT_PATH, 'project.config.json')}`)
  }

  if (isPortListening(AUTO_PORT)) {
    log(`[connect] 端口 ${AUTO_PORT} 已在监听，跳过启动`)
    return
  }

  log(`[connect] 端口 ${AUTO_PORT} 未检测到，启动 auto 模式...`)
  const args = [
    'auto',
    '--project', PROJECT_PATH,
    '--auto-port', String(AUTO_PORT),
    '--trust-project',
  ]

  try {
    const result = cp.spawnSync(CLI_PATH, args, {
      timeout: TIMEOUTS.AUTO_LAUNCH_TIMEOUT,
      encoding: 'utf-8',
      shell: process.platform === 'win32',
    })
    if (result.stdout && result.stdout.trim()) {
      log(`[connect] cli stdout: ${result.stdout.trim().slice(-500)}`)
    }
    if (result.stderr && result.stderr.trim()) {
      log(`[connect] cli stderr: ${result.stderr.trim().slice(-500)}`)
    }
    if (result.error) {
      throw result.error
    }
    if (result.status && result.status !== 0) {
      log(`[connect] cli auto exit status: ${result.status}`)
    }
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

  // 已在非登录页，跳过登录
  if (!page.path.includes('login')) {
    log(`[login] 已登录，跳过`)
    return
  }

  let loginPage
  if (page.path.includes('phoneLogin')) {
    loginPage = page
  } else {
    log('[login] on login page, navigating to phoneLogin...')
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

async function closeFilter(page) {
  log('[step] 关闭筛选弹窗...')
  const backBtns = await page.$$('.back-btn-wrap')
  if (backBtns.length === 0) {
    log('  [WARN] back button not found, skipping close')
    return
  }
  // 筛选弹窗在 root-portal 中渲染，其 back-btn-wrap 在 DOM 顺序中排在最后
  await backBtns[backBtns.length - 1].tap()
  await sleep(TIMEOUTS.FILTER_FILL_GAP)
  log('  OK filter modal closed')
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

  // 非城市选项：education / graduate_time / companyType / job_type
  const targetKeys = ['education', 'graduate_time', 'companyType', 'job_type']
  for (const key of targetKeys) {
    const target = criteria[key]
    if (!target) continue
    const candidates = filterOptionCandidates(key, target)
    let selected = false
    for (const btn of optionBtns) {
      try {
        const text = await btn.text()
        if (candidates.includes(text)) {
          await btn.tap()
          log(`  OK selected ${key}: ${text}`)
          await sleep(TIMEOUTS.FILTER_FILL_GAP)
          selected = true
          break
        }
      } catch { /* skip stale btn ref */ }
    }
    if (!selected) {
      log(`  [WARN] 未找到 ${key} 选项: ${target} (候选: ${candidates.join(' / ')})`)
    }
  }

}

async function waitForAreaChoicePage(mp) {
  for (let i = 0; i < 8; i++) {
    const currentPage = await mp.currentPage()
    if (currentPage && currentPage.path.includes('areaChoice')) {
      return currentPage
    }
    log(`  [debug] 等待城市选择页加载... (${i + 1}/8)`)
    await sleep(500)
  }

  return null
}

async function tapCityMoreInFilter(page) {
  let citySection = await page.$('#locationPreference')

  if (!citySection) {
    const categoryItems = await page.$$('.category-item')
    for (const item of categoryItems) {
      try {
        const text = normalizeAreaText(await item.text())
        if (text === '城市') {
          log('  点击左边侧栏"城市"按钮')
          await item.tap()
          await sleep(TIMEOUTS.FILTER_FILL_GAP)
          break
        }
      } catch {}
    }

    citySection = await page.$('#locationPreference')
  }

  if (!citySection) {
    const sections = await page.$$('.option-section')
    for (const section of sections) {
      try {
        const text = normalizeAreaText(await section.text())
        const moreLink = await section.$('.more-link')
        if (moreLink && text.startsWith('城市')) {
          citySection = section
          break
        }
      } catch {}
    }
  }

  if (!citySection) {
    log('  [WARN] 未找到城市筛选 section (#locationPreference)')
    return false
  }

  const moreLink = await citySection.$('.more-link')
  if (!moreLink) {
    log('  [WARN] 未找到城市 section 内的"更多"按钮')
    return false
  }

  log('  点击城市 section 的"更多"按钮')
  await moreLink.tap()
  await sleep(TIMEOUTS.PAGE_LOAD + 1000)
  return true
}

async function findAndTapInScroll(page, options) {
  const {
    label,
    itemSelector,
    textSelector,
    scrollSelector,
    candidates,
    skipTexts = [],
    tapTarget = 'item',
    maxScrolls = 12,
    scrollStep = 260,
    avoidDeselect = false,
  } = options

  const scrollview = await page.$(scrollSelector)
  const seen = new Set()

  if (scrollview) {
    try {
      await scrollview.scrollTo(0, 0)
      await sleep(250)
    } catch {}
  }

  for (let i = 0; i <= maxScrolls; i++) {
    const items = await page.$$(itemSelector)
    log(`  [debug] ${label} 可见项: ${items.length}, scroll=${i}`)

    for (const item of items) {
      try {
        const textEl = await item.$(textSelector)
        if (!textEl) continue
        const text = normalizeAreaText(await textEl.text())
        if (!text || skipTexts.includes(text)) continue
        seen.add(text)

        if (areaMatches(text, candidates)) {
          if (avoidDeselect) {
            const checkbox = await item.$('.checkbox')
            const checkboxClass = checkbox ? await checkbox.attribute('class') : ''
            if (checkboxClass && checkboxClass.includes('checked')) {
              log(`  OK ${label}已选中: ${text}`)
              return { ok: true, text, alreadySelected: true }
            }
          }

          if (tapTarget === 'text') {
            await textEl.tap()
          } else {
            await item.tap()
          }
          log(`  OK 点击${label}: ${text}`)
          await sleep(TIMEOUTS.FILTER_FILL_GAP)
          return { ok: true, text }
        }
      } catch {}
    }

    if (!scrollview || i === maxScrolls) break

    try {
      await scrollview.scrollTo(0, scrollStep * (i + 1))
      await sleep(350)
    } catch (e) {
      log(`  [debug] ${label}滚动失败: ${e.message}`)
      break
    }
  }

  log(`  [WARN] 找不到${label}: ${candidates.join(' / ')}，已见: ${[...seen].slice(-8).join('、') || 'none'}`)
  return { ok: false }
}

async function clearCurrentProvinceFullSelection(areaPage) {
  const selectAllItem = await areaPage.$('.select-all-item')
  if (!selectAllItem) return

  try {
    const checkbox = await selectAllItem.$('.checkbox')
    const checkboxClass = checkbox ? await checkbox.attribute('class') : ''
    if (checkboxClass && checkboxClass.includes('checked')) {
      log('  [debug] 当前省份为全部选择，先取消全选')
      await selectAllItem.tap()
      await sleep(TIMEOUTS.FILTER_FILL_GAP)
    }
  } catch {}
}

async function selectCityOnAreaPage(mp, areaPage, cityName) {
  const plan = makeCitySelectionPlan(cityName)

  if (!plan.normalized) {
    log(`  [WARN] 城市名为空或不可识别: ${cityName}`)
    await mp.navigateBack()
    await sleep(TIMEOUTS.NAV_BACK_WAIT)
    return false
  }

  log(`  [debug] 城市归一化: ${cityName} -> ${plan.normalized}`)
  log(`  [debug] 目标省份: ${plan.targetProvince || plan.provinceCandidates.join(' / ')}`)
  log(`  [debug] 城市候选: ${plan.cityCandidates.join(' / ')}`)

  const provinceResult = await findAndTapInScroll(areaPage, {
    label: '省份',
    itemSelector: '.province-item',
    textSelector: '.province-name',
    scrollSelector: '.province-list',
    candidates: plan.provinceCandidates,
    skipTexts: ['不限'],
    tapTarget: 'text',
    maxScrolls: 16,
    scrollStep: 280,
  })

  if (!provinceResult.ok) {
    await mp.navigateBack()
    await sleep(TIMEOUTS.NAV_BACK_WAIT)
    return false
  }

  await clearCurrentProvinceFullSelection(areaPage)

  const cityResult = await findAndTapInScroll(areaPage, {
    label: '城市',
    itemSelector: '.city-item',
    textSelector: '.city-name',
    scrollSelector: '.city-list',
    candidates: plan.cityCandidates,
    skipTexts: ['全部选择'],
    tapTarget: 'item',
    maxScrolls: 16,
    scrollStep: 280,
    avoidDeselect: true,
  })

  if (!cityResult.ok) {
    log('  [WARN] 找不到具体城市，跳过保存，避免默认全选省份')
    await mp.navigateBack()
    await sleep(TIMEOUTS.NAV_BACK_WAIT)
    return false
  }

  const saveBtn = await areaPage.$('.save-btn')
  if (!saveBtn) {
    log('  [WARN] 找不到保存按钮 (.save-btn)')
    await mp.navigateBack()
    await sleep(TIMEOUTS.NAV_BACK_WAIT)
    return false
  }

  await saveBtn.tap()
  log('  OK 保存城市选择')
  await sleep(TIMEOUTS.NAV_BACK_WAIT)
  return true
}

/**
 * 在筛选弹窗中选择城市
 * 流程：点击左边侧栏"城市" → 点击城市 section 的"更多" → 进入 areaChoice 页面 → 精确选择城市 → 保存返回
 */
async function selectCityInFilter(mp, page, cityName) {
  log(`[step] 在筛选弹窗中选择城市: ${cityName}`)

  const moreClicked = await tapCityMoreInFilter(page)
  if (!moreClicked) return

  const areaPage = await waitForAreaChoicePage(mp)
  if (!areaPage || !areaPage.path.includes('areaChoice')) {
    log('  [WARN] 未进入城市选择页，跳过城市选择')
    return
  }

  await selectCityOnAreaPage(mp, areaPage, cityName)

  // 验证返回筛选弹窗
  const currentPage = await mp.currentPage()
  if (currentPage.path.includes('areaChoice')) {
    log('  [WARN] 仍在城市选择页，尝试返回')
    await mp.navigateBack()
    await sleep(TIMEOUTS.NAV_BACK_WAIT)
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

// ── City Selection via areaChoice page ─────────────────────────────

async function selectCity(mp, cityName) {
  log(`[step] 选择城市: ${cityName}`)
  let page = await mp.currentPage()

  // 点击搜索页顶部的城市选择器 (.city-selector)
  const citySelector = await page.$('.city-selector')
  if (!citySelector) {
    log('  [WARN] 找不到 .city-selector，跳过城市选择')
    return
  }
  await citySelector.tap()
  await sleep(TIMEOUTS.PAGE_LOAD + 1000)

  // 等待 areaChoice 页面
  let areaPage = await waitForAreaChoicePage(mp)
  if (!areaPage || !areaPage.path.includes('areaChoice')) {
    log('  [WARN] 未进入城市选择页，跳过')
    return
  }

  await selectCityOnAreaPage(mp, areaPage, cityName)

  // 验证返回搜索页
  const currentPage = await mp.currentPage()
  if (!currentPage.path.includes('position/search')) {
    await mp.reLaunch('/pages/position/search')
    await sleep(TIMEOUTS.PAGE_LOAD)
  }
}

// ── Single Cycle ────────────────────────────────────────────────────

async function runOneCycle(mp, criteria, index) {
  const tag = `[${index + 1}]`
  log(`\n${'='.repeat(50)}`)
  log(`${tag} 开始处理: ${JSON.stringify(criteria)}`)
  log(`${'='.repeat(50)}`)

  try {
    let page = await navigateToSearch(mp)

    // 打开筛选弹窗
    await openFilter(page)
    await fillFilters(page, criteria)

    // 在筛选弹窗中选择城市
    if (criteria.city) {
      await selectCityInFilter(mp, page, criteria.city)
    }

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
  normalizeCityName,
  normalizeGraduateTime,
  screenshot,
  smoothScroll,
  connect,
  ensureLoggedIn,
  navigateToSearch,
  openFilter,
  closeFilter,
  fillFilters,
  selectCity,
  selectCityInFilter,
  submitMatch,
  enterJobAndScroll,
  goBack,
  runOneCycle,
  TIMEOUTS,
}
