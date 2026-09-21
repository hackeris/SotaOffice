// main-shim.mjs —— Electron on OHOS 兼容层(自检版;桩件裁剪,每件独立致命,勿精简)
//
// 探测结果存 globalThis.__GO_PROBES__,main.mjs 的 selfcheck:probe handler 读取展示。
import fs from 'node:fs'
import path from 'node:path'

const PROBES = (globalThis.__GO_PROBES__ = {})
const LOG = '/data/storage/el2/base/files/shim-log.txt'
const log = (m) => { try { fs.mkdirSync(path.dirname(LOG), { recursive: true }); fs.appendFileSync(LOG, `${new Date().toISOString()} ${m}\n`) } catch {} }

log('=== main-shim start ===')

// ---- 0.【探测】打桩前的原始状态(自检页展示;先于一切 mock)----
// requestSingleInstanceLock 的裸调推迟到 §4(app 模块引入后、打桩前)
PROBES.rawPlatform = process.platform
PROBES.rawSingleInstanceLock = 'deferred'
log(`probe: rawPlatform=${PROBES.rawPlatform}`)

// ---- 1. process.platform → 'linux' ----
// fork 报 'openharmony',三方平台分支普遍不认识(GenOffice shell 自身也有 win32/darwin/linux 三分支)
Object.defineProperty(process, 'platform', { value: 'linux', configurable: false, writable: false })
log('stub: process.platform = linux')

// ---- 2. process.title 打桩(OHOS 无 setproctitle,setter 会抛)----
try {
  let title = process.title
  Object.defineProperty(process, 'title', {
    get: () => title,
    set: (v) => { title = v },
    configurable: true,
  })
  log('stub: process.title getter/setter')
} catch (e) { log(`stub-skip: process.title(${e?.message})`) }

// ---- 3. HOME/XDG/TMPDIR 环境改造 + chdir ----
// 沙箱规则:子进程只能 chdir 到 /data/storage 下;用户数据落 el2
const EL2 = '/data/storage/el2/base/files'
const home = process.env.HOME && process.env.HOME.startsWith('/storage/Users/')
  ? process.env.HOME
  : path.join(EL2, 'home')
for (const [k, v] of [
  ['HOME', home],
  ['XDG_CONFIG_HOME', path.join(EL2, 'home/.config')],
  ['XDG_CACHE_HOME', path.join(EL2, 'cache')],
  ['XDG_DATA_HOME', path.join(EL2, 'home/.local/share')],
  ['TMPDIR', path.join(EL2, 'cache/tmp')],
]) {
  try { fs.mkdirSync(v, { recursive: true }) } catch {}
  process.env[k] = v
}
try { process.chdir(EL2) } catch (e) { log(`chdir failed: ${e?.message}`) }
log(`env: HOME=${process.env.HOME} cwd=${process.cwd()}`)

// ---- 4. 单实例 API 打桩 ----
// 官方 API 矩阵:requestSingleInstanceLock/second-instance 不支持;OHOS 单实例语义由
// module.json5 launchType + AppScope multiAppMode 管 → JS 层恒 true(GenOffice shell 的
// lock 获取逻辑因此直通,second-instance 路由由 deeplink/skills 承接)
const { app } = await import('electron')
if (typeof app.requestSingleInstanceLock !== 'function') {
  PROBES.rawSingleInstanceLock = 'absent(no-op undefined)'
} else {
  // 裸调一次看真实行为(返回值/是否抛),再打桩
  try { PROBES.rawSingleInstanceLock = `returns:${app.requestSingleInstanceLock({ probe: 1 })}` }
  catch (e) { PROBES.rawSingleInstanceLock = `throws:${e?.message}` }
}
app.requestSingleInstanceLock = () => true
app.hasSingleInstanceLock = () => true
app.releaseSingleInstanceLock = () => true
log(`stub: single-instance(raw=${PROBES.rawSingleInstanceLock})`)

// ---- 5. powerMonitor 订阅吞异常 ----
// fork 缺 setListeningForShutdown,订阅即 native abort(真机实证)
try {
  const pm = (await import('electron')).powerMonitor
  for (const m of ['addListener', 'on', 'once', 'removeListener', 'off', 'prependListener']) {
    const orig = pm?.[m]
    if (typeof orig === 'function') {
      pm[m] = (...a) => { try { return orig.apply(pm, a) } catch (e) { log(`powerMonitor.${m} swallowed: ${e?.message}`) } }
    }
  }
  log('stub: powerMonitor listeners wrapped')
} catch (e) { log(`powerMonitor wrap failed: ${e?.message}`) }

// ---- 6. WCO 三 API 打桩(fork 无 titleBarOverlay;frameless 无系统三键)----
const { BrowserWindow } = await import('electron')
for (const m of ['setTitleBarOverlay', 'setWindowButtonVisibility', 'setWindowButtonPosition']) {
  if (typeof BrowserWindow.prototype[m] === 'function') {
    const orig = BrowserWindow.prototype[m]
    BrowserWindow.prototype[m] = function (...a) { try { return orig.apply(this, a) } catch { /* no-op */ } }
  } else {
    BrowserWindow.prototype[m] = function () { PROBES[`wco:${m}:absent`] = true }
  }
}
app.on('browser-window-created', (_e, win) => {
  for (const m of ['setTitleBarOverlay', 'setWindowButtonVisibility', 'setWindowButtonPosition']) {
    if (typeof win[m] !== 'function') win[m] = function () {}
  }
})
log('stub: WCO 3 APIs')

// ---- 7. 兜底:未捕获异常落 shim-log ----
process.on('uncaughtException', (e) => log(`uncaughtException: ${e?.stack || e}`))
process.on('unhandledRejection', (r) => log(`unhandledRejection: ${r?.stack || r}`))

log('=== shim done, loading main.mjs ===')
try {
  await import('./main.mjs')
  log('main.mjs loaded')
} catch (e) {
  log(`main.mjs FAILED: ${e?.stack || e}`)
  try { app.quit() } catch {}
}
