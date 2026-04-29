const automator = require('miniprogram-automator')
const cp = require('child_process')

async function main() {
  const auto = cp.spawn('D:/software/微信web开发者工具/cli.bat', [
    'auto', '--project', 'D:/aibz/dist/dev/mp-weixin', '--auto-port', '9420'
  ], { shell: true, stdio: 'pipe' })

  await new Promise(r => {
    const t = setTimeout(r, 15000)
    auto.stderr.on('data', d => {
      if (d.toString().includes('auto')) { clearTimeout(t); setTimeout(r, 3000) }
    })
  })

  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' })
  console.log('Connected')

  const page = await mp.reLaunch('/pages/position/search')
  await page.waitFor(3000)

  // 点击筛选
  const filterBtn = await page.$('.filter-icon')
  await filterBtn.tap()
  console.log('Tapped filter-icon')

  // 等弹窗渲染完成
  await page.waitFor('.confirm-btn', 10000)
  console.log('confirm-btn appeared!')

  // 在 page 级别查找所有元素
  const confirmBtn = await page.$('.confirm-btn')
  const resetBtn = await page.$('.reset-btn')
  console.log('confirm-btn:', confirmBtn ? 'FOUND' : 'NOT FOUND')
  console.log('reset-btn:', resetBtn ? 'FOUND' : 'NOT FOUND')

  // 找 input
  const inputs = await page.$$('.input-field')
  console.log('input-field count:', inputs.length)
  for (let i = 0; i < Math.min(inputs.length, 5); i++) {
    const wxml = await inputs[i].wxml()
    console.log(`  input[${i}]:`, wxml.slice(0, 120))
  }

  // 找 option-btn
  const optionBtns = await page.$$('.option-btn')
  console.log('option-btn count:', optionBtns.length)
  for (let i = 0; i < Math.min(optionBtns.length, 10); i++) {
    const t = await optionBtns[i].text()
    console.log(`  btn[${i}]: "${t}"`)
  }

  // 截图
  const fs = require('fs')
  if (!fs.existsSync('D:/aibz/automation/screenshots')) fs.mkdirSync('D:/aibz/automation/screenshots', { recursive: true })
  await mp.screenshot({ path: 'D:/aibz/automation/screenshots/debug-filter-open.png' })
  console.log('Screenshot saved')

  mp.disconnect()
  auto.kill()
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
