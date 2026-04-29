const fs = require('fs')
const path = require('path')
const {
  initLogging, log, connect, ensureLoggedIn, runOneCycle, sleep
} = require('./lib/automation-core')

// ── Test output directory ───────────────────────────────────────────
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const RUN_DIR = path.join(__dirname, 'test-runs', RUN_ID)

function parseArgs() {
  const args = process.argv.slice(2)
  let queriesFile = null
  let singleInput = null

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--file' && args[i + 1]) {
      queriesFile = args[++i]
    } else if (args[i] === '--input' && args[i + 1]) {
      singleInput = args[++i]
    }
  }

  if (!queriesFile && !singleInput) {
    console.log('Usage:')
    console.log('  node loop-search.js --file <queries.json>')
    console.log('  node loop-search.js --input \'{"position":"Java开发","education":"本科"}\'')
    process.exit(1)
  }

  let queries
  if (queriesFile) {
    const raw = fs.readFileSync(path.resolve(queriesFile), 'utf-8')
    queries = JSON.parse(raw)
  } else {
    queries = [JSON.parse(singleInput)]
  }

  if (!Array.isArray(queries) || queries.length === 0) {
    console.error('输入必须是非空数组')
    process.exit(1)
  }

  return queries
}

async function main() {
  initLogging(RUN_DIR)
  const queries = parseArgs()
  log(`开始测试 — 共 ${queries.length} 组查询条件`)
  log(`运行目录: ${RUN_DIR}`)

  let mp
  try {
    mp = await connect()

    await ensureLoggedIn(mp)

    for (let i = 0; i < queries.length; i++) {
      await runOneCycle(mp, queries[i], i)
    }

    log('\nDONE - all queries finished')
  } catch (err) {
    log(`\nFATAL: ${err.message}`)
    process.exit(1)
  } finally {
    // 不断开连接，保持登录态
    log('测试结束（连接保持不断开）')
  }
}

main()
