/**
 * watch-danmu.js
 * 监听弹幕解析模块输出的 JSONL 文件，自动消费新查询并串行执行小程序 UI 搜索。
 *
 * 用法：
 *   DANMU_JSONL_DIR=/path/to/output node automation/watch-danmu.js
 *
 * 环境变量：
 *   DANMU_JSONL_DIR         (必填) JSONL 输出目录路径
 *   DANMU_LIVE_ID           (可选) 过滤特定 live_id 前缀
 *   DEDUP_WINDOW_MS         (可选) 去重窗口，默认 30000ms
 *   POLL_INTERVAL_MS        (可选) 轮询间隔，默认 2000ms
 *   WECHAT_DEVTOOLS_CLI     (可选) DevTools CLI 路径
 *   WECHAT_MINIPROGRAM_PROJECT (可选) 小程序项目路径
 *   WECHAT_AUTO_PORT        (可选) DevTools 端口，默认 9420
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const {
  initLogging, log, connect, ensureLoggedIn, runOneCycle, sleep
} = require('./lib/automation-core')

// ── 配置 ──────────────────────────────────────────────────────────
const DANMU_JSONL_DIR = process.env.DANMU_JSONL_DIR
const DANMU_LIVE_ID = process.env.DANMU_LIVE_ID || ''
const DEDUP_WINDOW_MS = parseInt(process.env.DEDUP_WINDOW_MS || '30000', 10)
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '2000', 10)

const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const RUN_DIR = path.join(__dirname, 'test-runs', `watch-${RUN_ID}`)

// ── 工具函数 ──────────────────────────────────────────────────────

function compact(obj) {
  const result = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined || v === '') continue
    if (Array.isArray(v) && v.length === 0) continue
    result[k] = v
  }
  return result
}

function md5(str) {
  return crypto.createHash('md5').update(str).digest('hex')
}

function now() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19)
}

// ── 字段适配 ──────────────────────────────────────────────────────

const EDU_WHITELIST = ['本科', '硕士', '博士', '大专']

/**
 * 将弹幕解析记录转为小程序 UI 自动化的筛选条件
 */
function toAutomationCriteria(record) {
  const payload = record.query_payload || {}
  const first = (v) => Array.isArray(v) ? v[0] : v

  const education = record.education || payload.education

  return compact({
    position: record.keyword || first(payload.intention_job),
    company: payload.intention_company,
    education: EDU_WHITELIST.includes(education) ? education : undefined,
    companyType: payload.company_type,
    job_type: payload.job_type,
    city: record.city || first(payload.intention_location),
  })
}

// ── 记录解析 ──────────────────────────────────────────────────────

/**
 * 判断是否为弹幕查询事件（排除 automation_* 状态事件）
 */
function isQueryEvent(record) {
  // 跳过自动化模块自己写的状态事件
  if (record.type && record.type.startsWith('automation_')) return false
  // 包含 keyword 或 query_payload 的视为查询事件
  return !!(record.keyword || (record.query_payload && record.query_payload.intention_job))
}

/**
 * 解析单行 JSON，失败返回 null
 */
function parseRecord(line) {
  try {
    return JSON.parse(line.trim())
  } catch {
    return null
  }
}

// ── 去重缓存 ──────────────────────────────────────────────────────

class DedupeCache {
  constructor(windowMs) {
    this._windowMs = windowMs
    this._cache = new Map() // key -> timestamp
  }

  /**
   * 检查是否重复，如果不是重复则记录并返回 false
   * @returns {boolean} true = 重复，应跳过
   */
  check(criteria) {
    const key = md5([
      criteria.position || '',
      criteria.company || '',
      criteria.education || '',
      criteria.companyType || '',
      criteria.job_type || '',
      criteria.city || '',
    ].join('|'))

    const now = Date.now()
    const last = this._cache.get(key)

    if (last && (now - last) < this._windowMs) {
      return true // 重复
    }

    this._cache.set(key, now)
    this._cleanup(now)
    return false
  }

  _cleanup(now) {
    for (const [key, ts] of this._cache) {
      if (now - ts > this._windowMs) {
        this._cache.delete(key)
      }
    }
  }
}

// ── 串行队列 ──────────────────────────────────────────────────────

class SerialQueue {
  constructor() {
    this._queue = []
    this._running = false
  }

  push(fn) {
    this._queue.push(fn)
    this._drain()
  }

  get length() {
    return this._queue.length
  }

  async _drain() {
    if (this._running) return
    this._running = true
    while (this._queue.length > 0) {
      const fn = this._queue.shift()
      try {
        await fn()
      } catch (e) {
        log(`[queue] task error: ${e.message}`)
      }
    }
    this._running = false
  }

  async waitForDrain() {
    while (this._running || this._queue.length > 0) {
      await sleep(500)
    }
  }
}

// ── 状态事件写入 ──────────────────────────────────────────────────

function writeStatusEvent(filePath, event) {
  try {
    fs.appendFileSync(filePath, JSON.stringify(event, null, 0) + '\n')
  } catch (e) {
    log(`[status] 写入状态事件失败: ${e.message}`)
  }
}

// ── 文件发现与 Tail 读取 ─────────────────────────────────────────

/**
 * 在目录中找到最新的 .jsonl 文件
 * @returns {string|null} 文件完整路径，无文件时返回 null
 */
function findLatestJsonl(dir) {
  try {
    const files = fs.readdirSync(dir)
      .filter(f => f.endsWith('.jsonl'))
      .filter(f => !DANMU_LIVE_ID || f.startsWith(DANMU_LIVE_ID))
      .sort((a, b) => {
        // 按时间戳部分排序（文件名格式: {live_id}_{YYYYMMDD_HHMMSS}.jsonl）
        const tsA = a.replace('.jsonl', '').split('_').slice(1).join('_')
        const tsB = b.replace('.jsonl', '').split('_').slice(1).join('_')
        return tsA.localeCompare(tsB)
      })
    return files.length > 0 ? path.join(dir, files[files.length - 1]) : null
  } catch {
    return null
  }
}

/**
 * 从指定 offset 读取新行
 * @returns {{ lines: string[], newOffset: number, fileChanged: boolean }}
 */
function readNewLines(filePath, offset) {
  try {
    const stat = fs.statSync(filePath)
    const fileSize = stat.size

    // 文件被截断（重启场景）— 检测到新文件时由 watcher 处理
    if (fileSize < offset) {
      return { lines: [], newOffset: fileSize, fileChanged: true }
    }

    if (fileSize === offset) {
      return { lines: [], newOffset: offset, fileChanged: false }
    }

    // 读取新内容
    const fd = fs.openSync(filePath, 'r')
    const buf = Buffer.alloc(fileSize - offset)
    fs.readSync(fd, buf, 0, buf.length, offset)
    fs.closeSync(fd)

    const content = buf.toString('utf-8')
    const parts = content.split('\n')

    // 最后一个元素可能是不完整的行（没有尾部 \n）
    const lastPart = parts[parts.length - 1]
    const hasTrailingNewline = content.endsWith('\n')

    let completeLines
    let consumedBytes

    if (hasTrailingNewline) {
      // 所有行都是完整的
      completeLines = parts.filter(line => line.trim().length > 0)
      consumedBytes = fileSize - offset
    } else {
      // 最后一个部分是不完整的行，留到下次
      completeLines = parts.slice(0, -1).filter(line => line.trim().length > 0)
      consumedBytes = fileSize - offset - lastPart.length
    }

    return {
      lines: completeLines,
      newOffset: offset + consumedBytes,
      fileChanged: false,
    }
  } catch (e) {
    if (e.code === 'ENOENT') {
      return { lines: [], newOffset: 0, fileChanged: true }
    }
    throw e
  }
}

// ── JSONL 轮询器 ──────────────────────────────────────────────────

class JsonlWatcher {
  constructor(dir, pollIntervalMs) {
    this._dir = dir
    this._intervalMs = pollIntervalMs
    this._timer = null
    this._currentFile = null
    this._offset = 0
    this._callback = null
    this._partialLine = ''
  }

  /**
   * 开始轮询
   * @param {function} onNewLines - 回调：(lines: string[]) => void
   */
  start(onNewLines) {
    this._callback = onNewLines
    this._init()
    this._timer = setInterval(() => this._poll(), this._intervalMs)
    log(`[watcher] 开始监听目录: ${this._dir}，间隔 ${this._intervalMs}ms`)
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer)
      this._timer = null
    }
    log('[watcher] 已停止')
  }

  _init() {
    // 首次启动：找到最新文件，从文件末尾开始（跳过历史内容）
    const latest = findLatestJsonl(this._dir)
    if (latest) {
      this._currentFile = latest
      try {
        const stat = fs.statSync(latest)
        this._offset = stat.size
        log(`[watcher] 发现文件: ${path.basename(latest)}，从末尾开始（offset=${this._offset}）`)
      } catch {
        this._offset = 0
      }
    } else {
      log('[watcher] 暂无 JSONL 文件，等待新文件出现...')
    }
  }

  _poll() {
    try {
      // 检查是否有新文件（auto-live-room 重启场景）
      const latest = findLatestJsonl(this._dir)
      if (!latest) return

      if (latest !== this._currentFile) {
        // 发现新文件
        if (this._currentFile) {
          // 先读完旧文件的剩余内容
          this._readAndDispatch(this._currentFile)
        }
        this._currentFile = latest
        this._offset = 0 // 新文件从头开始读（因为是刚出现的文件）
        log(`[watcher] 切换到新文件: ${path.basename(latest)}`)
      }

      if (this._currentFile) {
        this._readAndDispatch(this._currentFile)
      }
    } catch (e) {
      log(`[watcher] 轮询错误: ${e.message}`)
    }
  }

  _readAndDispatch(filePath) {
    const { lines, newOffset, fileChanged } = readNewLines(filePath, this._offset)
    this._offset = newOffset

    if (fileChanged) {
      // 文件被截断，重置
      log('[watcher] 检测到文件变化，重置 offset')
      try {
        this._offset = fs.statSync(filePath).size
      } catch {}
      return
    }

    if (lines.length > 0 && this._callback) {
      this._callback(lines)
    }
  }
}

// ── 主流程 ────────────────────────────────────────────────────────

async function main() {
  // 1. 校验环境变量
  if (!DANMU_JSONL_DIR) {
    console.error('错误：请设置 DANMU_JSONL_DIR 环境变量，指向 JSONL 输出目录')
    console.error('示例：DANMU_JSONL_DIR=/path/to/output node automation/watch-danmu.js')
    process.exit(1)
  }

  if (!fs.existsSync(DANMU_JSONL_DIR)) {
    console.error(`错误：DANMU_JSONL_DIR 目录不存在: ${DANMU_JSONL_DIR}`)
    process.exit(1)
  }

  // 2. 初始化日志
  initLogging(RUN_DIR)
  log('========================================')
  log('弹幕 JSONL Watcher 启动')
  log(`监听目录: ${DANMU_JSONL_DIR}`)
  log(`Live ID 过滤: ${DANMU_LIVE_ID || '（不过滤）'}`)
  log(`去重窗口: ${DEDUP_WINDOW_MS}ms`)
  log(`轮询间隔: ${POLL_INTERVAL_MS}ms`)
  log(`运行目录: ${RUN_DIR}`)
  log('========================================')

  // 3. 连接微信开发者工具 + 登录
  let mp
  try {
    mp = await connect()
    await ensureLoggedIn(mp)
  } catch (err) {
    log(`FATAL: 连接或登录失败: ${err.message}`)
    process.exit(1)
  }

  // 4. 初始化去重缓存和串行队列
  const dedupe = new DedupeCache(DEDUP_WINDOW_MS)
  const queue = new SerialQueue()
  let cycleIndex = 0
  let shutdownRequested = false

  // 5. 启动文件轮询器
  const watcher = new JsonlWatcher(DANMU_JSONL_DIR, POLL_INTERVAL_MS)

  watcher.start((lines) => {
    for (const line of lines) {
      const record = parseRecord(line)
      if (!record) {
        log(`[parse] JSON 解析失败，跳过: ${line.slice(0, 80)}`)
        continue
      }

      if (!isQueryEvent(record)) continue

      const criteria = toAutomationCriteria(record)
      if (!criteria.position && !criteria.company) {
        log(`[adapt] 无有效筛选条件，跳过: ${record.raw_text || line.slice(0, 80)}`)
        continue
      }

      if (dedupe.check(criteria)) {
        log(`[dedup] 重复查询，跳过: ${JSON.stringify(criteria)}`)
        continue
      }

      const idx = cycleIndex++
      const traceId = record.trace_id || `auto-${RUN_ID}-${idx}`
      const criteriaJson = JSON.stringify(criteria)

      log(`[enqueue] #${idx} ${criteriaJson} (trace: ${traceId})`)

      queue.push(async () => {
        if (shutdownRequested) return

        const jsonlPath = findLatestJsonl(DANMU_JSONL_DIR)

        // 写入 started 事件
        if (jsonlPath) {
          writeStatusEvent(jsonlPath, {
            type: 'automation_started',
            trace_id: traceId,
            ts: now(),
            criteria,
          })
        }

        try {
          await runOneCycle(mp, criteria, idx)

          // 写入 done 事件
          if (jsonlPath) {
            writeStatusEvent(jsonlPath, {
              type: 'automation_done',
              trace_id: traceId,
              ts: now(),
              status: 'ok',
            })
          }
        } catch (err) {
          log(`[error] cycle #${idx} failed: ${err.message}`)

          // 写入 failed 事件
          if (jsonlPath) {
            writeStatusEvent(jsonlPath, {
              type: 'automation_failed',
              trace_id: traceId,
              ts: now(),
              status: 'failed',
              error: err.message,
            })
          }
        }
      })
    }
  })

  // 6. 优雅退出
  const shutdown = async () => {
    if (shutdownRequested) return
    shutdownRequested = true
    log('\n[shutdown] 收到退出信号，正在停止...')
    watcher.stop()
    log('[shutdown] 等待队列排空...')
    await queue.waitForDrain()
    log('[shutdown] 完成')
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  // 保持进程运行
  log('Watcher 运行中，按 Ctrl+C 退出')
  await new Promise(() => {}) // 永不 resolve
}

main()
