const automator = require('miniprogram-automator')
const cp = require('child_process')
const fs = require('fs')

const CLI_PATH = 'D:/software/微信web开发者工具/cli.bat'
const PROJECT_PATH = 'D:/aibz/dist/dev/mp-weixin'
const AUTO_PORT = 9420

const TEST_DATA = {
  position: 'Java开发',
  company: '腾讯',
  education: '本科',
  companyType: '央国企',
  job_type: '全职',
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function main() {
  // 先尝试连接已有的 auto 实例，如果没有就启动
  let mp, autoProcess

  console.log('[0] 连接开发者工具...')
  try {
    mp = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${AUTO_PORT}` })
    console.log('  ✓ 已连接到现有实例')
  } catch {
    console.log('  现有实例不可用，启动 auto 模式...')
    autoProcess = cp.spawn(CLI_PATH, [
      'auto', '--project', PROJECT_PATH, '--auto-port', String(AUTO_PORT)
    ], { stdio: 'pipe', shell: true })

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('auto 模式启动超时')), 30000)
      autoProcess.stderr.on('data', d => {
        if (d.toString().includes('auto')) {
          clearTimeout(timeout)
          setTimeout(resolve, 5000)
        }
      })
      autoProcess.on('error', e => { clearTimeout(timeout); reject(e) })
    })
    console.log('  ✓ auto 模式已启动')

    // 重试连接
    for (let i = 0; i < 5; i++) {
      try {
        mp = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${AUTO_PORT}` })
        console.log('  ✓ 已连接')
        break
      } catch {
        console.log(`  连接重试 ${i + 1}/5...`)
        await sleep(2000)
      }
    }
    if (!mp) throw new Error('无法连接到开发者工具')
  }

  try {
    // 导航到搜索页
    console.log('[1/4] 导航到搜索页...')
    const page = await mp.reLaunch('/pages/position/search')
    await sleep(3000)
    console.log('  ✓ 搜索页已加载, path:', page.path)

    // 点击筛选
    console.log('[2/4] 点击筛选按钮...')
    const filterBtn = await page.$('.filter-icon')
    if (!filterBtn) throw new Error('筛选按钮未找到')
    await filterBtn.tap()
    await page.waitFor('.confirm-btn', 10000)
    await sleep(2000)
    console.log('  ✓ 筛选弹窗已打开')

    // 填入测试样例
    console.log('[3/4] 填入测试样例...')
    const inputs = await page.$$('.input-field')
    console.log(`  找到 ${inputs.length} 个输入框`)

    if (inputs[0]) {
      await inputs[0].input(TEST_DATA.position)
      console.log(`  ✓ 岗位名称: ${TEST_DATA.position}`)
      await sleep(500)
    }
    if (inputs[2]) {
      await inputs[2].input(TEST_DATA.company)
      console.log(`  ✓ 公司名称: ${TEST_DATA.company}`)
      await sleep(500)
    }

    // 选项按钮 - 逐个找并点击
    const optionBtns = await page.$$('.option-btn')
    console.log(`  找到 ${optionBtns.length} 个选项按钮`)

    const targets = [TEST_DATA.education, TEST_DATA.companyType, TEST_DATA.job_type]
    for (const target of targets) {
      for (const btn of optionBtns) {
        try {
          const text = await btn.text()
          if (text === target) {
            await btn.tap()
            console.log(`  ✓ 已选择: ${target}`)
            await sleep(500)
            break
          }
        } catch { /* skip broken btn ref after tap */ }
      }
    }

    // 截图 - 填入后、匹配前
    const dir = 'D:/aibz/automation/screenshots'
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    await mp.screenshot({ path: `${dir}/before-match-${Date.now()}.png` })
    console.log('  ✓ 截图已保存（匹配前）')

    // 点击开始匹配
    console.log('[4/4] 点击开始匹配...')
    const confirmBtn = await page.$('.confirm-btn')
    if (!confirmBtn) throw new Error('开始匹配按钮未找到')
    await confirmBtn.tap()
    console.log('  ✓ 已点击开始匹配')

    // 等待结果
    await sleep(8000)
    try {
      const resultEl = await page.$('.position-news')
      if (resultEl) {
        const text = await resultEl.text()
        console.log(`\n========== 结果 ==========`)
        console.log(text)
      }
    } catch {}

    const jobItems = await page.$$('xtx-job-item')
    console.log(`岗位列表项数: ${jobItems.length}`)

    await mp.screenshot({ path: `${dir}/after-match-${Date.now()}.png` })
    console.log('✓ 截图已保存（匹配后）')

  } catch (err) {
    console.error('\n❌ 错误:', err.message)
    try {
      const dir = 'D:/aibz/automation/screenshots'
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      await mp.screenshot({ path: `${dir}/error-${Date.now()}.png` })
    } catch {}
    throw err
  } finally {
    mp.disconnect()
    if (autoProcess) autoProcess.kill()
    console.log('\n✓ 已断开连接')
  }
}

main().catch(e => { console.error(e); process.exit(1) })
