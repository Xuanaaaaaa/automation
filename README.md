# AIBZ MiniProgram Automation

Automated end-to-end testing for the AIBZ WeChat mini-program using `miniprogram-automator`. The script logs in, then iterates through a list of search queries, filling filter criteria, submitting matches, viewing job details, and capturing screenshots at every step.

## Prerequisites

- **Node.js** installed and available on PATH
- **WeChat DevTools** installed locally
- **Mini-program project** compiled to an `mp-weixin` directory
- **miniprogram-automator** installed (`npm install miniprogram-automator`)

## Setup Steps

### 1. Initialize local paths

Run this once after cloning the repository:

```bash
node scripts/init-local-config.js
```

The wizard writes local machine settings to `config/local.jsonl`, including:

- WeChat DevTools CLI path
- Mini-program `mp-weixin` build path
- DevTools automation port
- Danmu JSONL output directory
- Local `NO_PROXY` setting

`config/local.jsonl` is ignored by git. Environment variables still override it when needed.

### 2. Open WeChat DevTools with the project

Launch DevTools and open the compiled project directory configured as `wechatMiniprogramProject`.

### 3. Enable service ports

In DevTools, go to **Settings > Security** and enable:

- **服务端口 (Service Port)**
- **多端插件服务端口**

Both must be on for the automator WebSocket connection to work.

### 4. Start automation mode

Usually the script starts automation mode automatically. To start it manually, use the configured CLI path and project path:

```bash
"/Applications/wechatwebdevtools.app/Contents/MacOS/cli" auto \
  --project "/path/to/aibz/dist/build/mp-weixin" \
  --auto-port 9420 \
  --trust-project
```

This opens a **new** DevTools instance in automation mode, listening on `ws://127.0.0.1:9420`.

> **Important:** `cli.bat auto` launches a separate DevTools process. Login state from any other open instance is **not** shared. You must log in again in the automated instance.

The Windows process name is `微信开发者工具` (Chinese). Searching for "wechat" or "微信web开发者工具" in a process list will not find it.

### 5. Verify connection

After the auto-mode instance finishes loading, you can confirm the port is open:

```bash
netstat -an | grep 9420
```

## Login

The script handles login automatically. It uses a fixed backend test account:

- **Phone:** 91231231234
- **Verification code:** 1111

Login flow executed by the script:

1. Navigate to `/pages/login/phoneLogin`
2. Fill phone number into the first `.input` field
3. Tap `.agreement-checkbox` to accept the user agreement
4. Tap `.code-btn` to request a verification code
5. Fill the code into the second `.input` field
6. Tap `.form-button` to submit login
7. Verify the page navigated away from the login page

## Loop Workflow

For each query entry in the input file, the script runs one cycle:

```
Navigate to search page (switchTab or navigateTo)
  -> Open filter popup (.filter-icon)
  -> Fill criteria (position, company, education, companyType, job_type)
  -> Submit match (.confirm-btn)
  -> Click first job item (xtx-job-item)
  -> Scroll detail page 5 times
  -> Go back to search page
  -> Next query
```

Each cycle is logged and screenshots are taken at key points: filter filled, results loaded, detail top, detail scrolled, and on errors.

## Running

**Batch mode** -- iterate all queries from a JSON file:

```bash
node automation/loop-search.js --file automation/test-queries.json
```

**Single query** -- run one ad-hoc query:

```bash
node automation/loop-search.js --input '{"position":"Java开发"}'
```

**With multiple filters:**

```bash
node automation/loop-search.js --input '{"position":"产品经理","education":"硕士","job_type":"全职"}'
```

## Input Format

The `--file` argument expects a JSON array of objects. Each object can include any combination of:

| Field         | Type   | Example       |
|---------------|--------|---------------|
| `position`    | string | "Java开发"    |
| `company`     | string | "中国银行"    |
| `education`   | string | "本科"        |
| `companyType` | string | "央国企"      |
| `job_type`    | string | "全职"        |

Example (`test-queries.json`):

```json
[
  { "position": "Java开发", "education": "本科", "companyType": "央国企" },
  { "position": "产品经理", "education": "硕士", "job_type": "全职" },
  { "position": "会计", "company": "中国银行", "education": "本科" }
]
```

## Output

Each run creates a timestamped directory under `automation/test-runs/`:

```
test-runs/
  2026-04-28T15-30-00/
    test.log              # timestamped log of all actions
    screenshots/
      0-login-page.png
      0-login-code-sent.png
      0-login-form-filled.png
      0-login-result.png
      1-filter.png
      1-result.png
      1-detail-top.png
      1-detail-scrolled.png
      2-filter.png
      ...
```

Screenshots are named by cycle index and step. Error screenshots use the `<cycle>-error.png` pattern.

## Key Selectors

| Selector              | Element                        |
|-----------------------|--------------------------------|
| `.filter-icon`        | Filter/open search criteria    |
| `.confirm-btn`        | Submit match button            |
| `.input-field`        | Text input fields in filter    |
| `.input`              | Login page inputs (phone/code) |
| `.option-btn`         | Option buttons (education etc) |
| `.position-news`      | Result count/statistics text   |
| `xtx-job-item`        | Job list item component        |
| `.form-button`        | Login submit button            |
| `.agreement-checkbox` | User agreement checkbox        |
| `.code-btn`           | Send verification code button  |

These selectors are based on compiled WXML class names and may change if source code is modified. Adding `test-id` attributes to source components would be more stable.

## Known Issues

**`cli.bat auto` opens a new DevTools instance.** Login state is not shared with any previously open instance. You must log in again each time.

**`page.waitFor()` can hang indefinitely.** The script uses `sleep()` plus element checks instead, which is more reliable in practice.

**xtx-job-item tap may expand inline instead of navigating to a detail page.** The script detects this and falls back to scrolling the current page, but no detail page is visited for that cycle.

**DevTools process name is `微信开发者工具`.** Tools like `tasklist` or `grep` searching for "wechat" or "微信web开发者工具" will not find it. Use the Chinese name exactly.

**Do not use `reLaunch()`.** It kills the login state. The script uses `switchTab`, `navigateTo`, and `navigateBack` for all navigation.

## File Structure

```
automation/
  loop-search.js         # Main automation script
  test-queries.json      # Sample query data
  debug-selectors.js     # Selector debugging utility
  test-search.js         # Older single-query script
  test-runs/             # Output directory (created at runtime)
  screenshots/           # Legacy screenshot directory
```
