const fs = require('fs')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '..')
const CONFIG_DIR = path.join(REPO_ROOT, 'config')
const DEFAULT_LOCAL_CONFIG_PATH = path.join(CONFIG_DIR, 'local.jsonl')

let _cachedConfig

function normalizeConfigKey(key) {
  return String(key || '').replace(/[_-]([a-z])/g, (_, char) => char.toUpperCase())
}

function parseJsonlConfig(content, filePath) {
  const result = {}
  const lines = content.split(/\r?\n/).map(line => line.trim()).filter(Boolean)

  for (const line of lines) {
    if (line.startsWith('#')) continue
    const parsed = JSON.parse(line)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`配置行必须是 JSON 对象: ${filePath}`)
    }
    Object.assign(result, parsed)
  }

  return result
}

function parseConfigFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8').trim()
  if (!content) return {}

  if (filePath.endsWith('.jsonl')) {
    return parseJsonlConfig(content, filePath)
  }

  const parsed = JSON.parse(content)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`配置文件必须是 JSON 对象: ${filePath}`)
  }
  return parsed
}

function getCandidateConfigPaths() {
  const explicitPath = process.env.AUTOMATION_LOCAL_CONFIG
  return [
    explicitPath,
    DEFAULT_LOCAL_CONFIG_PATH,
    path.join(CONFIG_DIR, 'local.json'),
  ].filter(Boolean)
}

function loadLocalConfig() {
  if (_cachedConfig) return _cachedConfig

  for (const filePath of getCandidateConfigPaths()) {
    try {
      if (!fs.existsSync(filePath)) continue
      const raw = parseConfigFile(filePath)
      const normalized = {}
      for (const [key, value] of Object.entries(raw)) {
        normalized[key] = value
        normalized[normalizeConfigKey(key)] = value
      }
      _cachedConfig = { path: filePath, values: normalized }
      return _cachedConfig
    } catch (err) {
      throw new Error(`读取本地配置失败 ${filePath}: ${err.message}`)
    }
  }

  _cachedConfig = { path: null, values: {} }
  return _cachedConfig
}

function readConfigValue(envName, localKeys = [], fallback = undefined) {
  if (envName && process.env[envName] !== undefined && process.env[envName] !== '') {
    return process.env[envName]
  }

  const config = loadLocalConfig().values
  for (const key of localKeys) {
    if (config[key] !== undefined && config[key] !== '') return config[key]
    const normalizedKey = normalizeConfigKey(key)
    if (config[normalizedKey] !== undefined && config[normalizedKey] !== '') {
      return config[normalizedKey]
    }
  }

  return fallback
}

function applyNoProxyConfig() {
  const noProxy = readConfigValue('NO_PROXY', ['noProxy', 'no_proxy', 'NO_PROXY'], '')
  if (!noProxy) return

  if (!process.env.NO_PROXY) process.env.NO_PROXY = noProxy
  if (!process.env.no_proxy) process.env.no_proxy = noProxy
}

module.exports = {
  REPO_ROOT,
  CONFIG_DIR,
  DEFAULT_LOCAL_CONFIG_PATH,
  loadLocalConfig,
  readConfigValue,
  applyNoProxyConfig,
}
