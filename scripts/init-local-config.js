#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const readline = require('readline')
const {
  REPO_ROOT,
  DEFAULT_LOCAL_CONFIG_PATH,
} = require('../lib/local-config')

function platformDefaults() {
  const isMac = process.platform === 'darwin'
  const isWin = process.platform === 'win32'

  return {
    wechatDevtoolsCli: isMac
      ? '/Applications/wechatwebdevtools.app/Contents/MacOS/cli'
      : 'D:/software/微信web开发者工具/cli.bat',
    wechatMiniprogramProject: isMac
      ? path.resolve(REPO_ROOT, '../aibz/dist/build/mp-weixin')
      : 'D:/aibz/dist/build/mp-weixin',
    wechatAutoPort: 9420,
    danmuJsonlDir: isMac
      ? path.resolve(REPO_ROOT, '../自动化直播间/弹幕提取/DouyinLiveWebFetcher/output')
      : 'D:/自动化直播间/弹幕提取/DouyinLiveWebFetcher/output',
    noProxy: '127.0.0.1,localhost,::1',
    ...(isWin ? { noProxy: '127.0.0.1,localhost' } : {}),
  }
}

function parseExistingConfig(filePath) {
  if (!fs.existsSync(filePath)) return {}

  const content = fs.readFileSync(filePath, 'utf8').trim()
  if (!content) return {}

  if (filePath.endsWith('.jsonl')) {
    return content
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'))
      .map(line => JSON.parse(line))
      .reduce((acc, item) => Object.assign(acc, item), {})
  }

  return JSON.parse(content)
}

function createReader() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })
}

function ask(rl, question, defaultValue) {
  const suffix = defaultValue !== undefined && defaultValue !== ''
    ? ` [${defaultValue}]`
    : ''

  return new Promise((resolve) => {
    rl.question(`${question}${suffix}: `, (answer) => {
      const trimmed = answer.trim()
      resolve(trimmed || defaultValue || '')
    })
  })
}

function warnIfMissing(label, targetPath, checker = fs.existsSync) {
  if (!targetPath) return
  if (!checker(targetPath)) {
    console.warn(`  [WARN] ${label} 不存在，请确认路径是否正确: ${targetPath}`)
  }
}

function printSummary(configPath, config) {
  console.log('\n已写入本地配置:')
  console.log(`  ${configPath}`)
  console.log('\n后续脚本会按以下优先级读取配置:')
  console.log('  环境变量 > config/local.jsonl > config/local.json > 内置默认值')
  console.log('\n当前配置:')
  console.log(JSON.stringify(config, null, 2))
}

async function main() {
  const args = new Set(process.argv.slice(2))
  const nonInteractive = args.has('--yes') || args.has('--defaults')
  const configPath = DEFAULT_LOCAL_CONFIG_PATH
  const defaults = platformDefaults()
  const existing = parseExistingConfig(configPath)
  const initial = { ...defaults, ...existing }

  console.log('本地自动化配置初始化')
  console.log('直接回车会使用方括号中的默认值。')
  console.log(`配置文件: ${configPath}\n`)

  let config
  if (nonInteractive) {
    config = initial
  } else {
    const rl = createReader()
    try {
      config = {
        wechatDevtoolsCli: await ask(rl, '微信开发者工具 CLI 路径', initial.wechatDevtoolsCli),
        wechatMiniprogramProject: await ask(rl, '小程序 mp-weixin 产物路径', initial.wechatMiniprogramProject),
        wechatAutoPort: Number(await ask(rl, '微信开发者工具自动化端口', initial.wechatAutoPort)),
        danmuJsonlDir: await ask(rl, '弹幕 JSONL 输出目录', initial.danmuJsonlDir),
        noProxy: await ask(rl, '本地地址绕过代理 NO_PROXY', initial.noProxy),
      }
    } finally {
      rl.close()
    }
  }

  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  fs.writeFileSync(configPath, JSON.stringify(config) + '\n', 'utf8')

  warnIfMissing('微信开发者工具 CLI', config.wechatDevtoolsCli)
  warnIfMissing('小程序 project.config.json', path.join(config.wechatMiniprogramProject, 'project.config.json'))
  warnIfMissing('弹幕 JSONL 输出目录', config.danmuJsonlDir)

  printSummary(configPath, config)
}

main().catch((err) => {
  console.error(`初始化失败: ${err.message}`)
  process.exit(1)
})
