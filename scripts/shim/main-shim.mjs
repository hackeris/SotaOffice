// main-shim.mjs —— GenOffice on Electron-OHOS 兼容层(M1 版,v6)
//
// 排障实录(hilog [GO-SHIM] 打点,2026-09-20 首亮):
//   v1/v2 症状"死在 platform 桩"实为 console 缓冲丢失假象 + shim 自杀:
//   out/main/index.js 是 electron-vite 产 CJS bundle,package.json 误带 type:module
//   → ESM 解析 → "exports is not defined" → shim catch 后 app.quit() → browser exited。
//   v3(零桩直载)实锤上述;v4 修复:package.json 去 type:module(组装脚本)+ 桩全量回加
//   + bundle 经 createRequire 以 CJS 加载。
//   v5/v6(2026-09-21 G4 真机双坑, uitest uiInput 系统输入 + CDP 双轨定位):
//   ⑤⑬ 输入死区:docs ribbon"插入~视图"选项卡对触屏/鼠标无响应(CDP 合成输入正常,
//       事件在 fork 输入管线消失,所有 view 的 pointerdown 均未触发)。真凶:fork 上
//       hidden 的 WebContentsView 仍参与命中测试(shell spare sheets view 常驻 hidden、
//       切走的 tab hidden,且 tab-manager activateTab 只 setBounds active view,非 active
//       bounds 冻结)。修复=桩⑬ parking:周期把 getVisible()===false 的 view setBounds
//       移出屏幕;activateTab 恢复时会重设 bounds,不冲突。真机验证:插入/审阅/开始/视图
//       全部 uitest 点击切换 ✓。
//   ⑭ 剪贴板反复弹窗:打开 pptx 反复弹"无法访问系统剪贴板"。机制:slides renderer
//       mount+focus 时 clipboardProbe → 主进程 clipboard.availableFormats()/readText()
//       → fork 走 @ohos.pasteboard,READ_PASTEBOARD 未授权触发系统提示;弹窗关闭→
//       focus 回归→再 probe→死循环。修复=桩⑭ 读侧静默(返回空,与 ACL 裁剪降级一致,
//       写侧保留);真机验证:开 pptx + 6 轮 tab 切换零弹窗。
// 桩清单顺序铁律:全部在加载 out/main/index.js 之前(bundle 顶层求值 resourcesPath/isPackaged)。
import fs from 'node:fs'
import path from 'node:path'

const PROBES = (globalThis.__GO_PROBES__ = {})
const LOG = '/data/storage/el2/base/files/shim-log.txt'
const EL2 = '/data/storage/el2/base/files'
const log = (m) => {
  try { fs.mkdirSync(path.dirname(LOG), { recursive: true }); fs.appendFileSync(LOG, `${new Date().toISOString()} ${m}\n`) } catch {}
  try { console.log(`[GO-SHIM] ${m}`) } catch {}
}

log('=== main-shim v4 start ===')
const APP_DIR = path.dirname(new URL(import.meta.url).pathname) // = resfile/resources/app
const RESOURCES_DIR = path.join(APP_DIR, '..')                  // = resfile/resources
const SIDECAR_RUNTIME = '/data/storage/el1/bundle/libs/arm64/xlsx-sidecar' // 运行期(无 -v8a,清单 §0)

PROBES.rawPlatform = process.platform
log(`probe: rawPlatform=${PROBES.rawPlatform}`)

// uncaught 先行(任何后续异常同步落日志;console 退出前可能丢缓冲,文件为准)
process.on('uncaughtException', (e) => { log(`uncaughtException: ${e?.stack || e}`) })
process.on('unhandledRejection', (r) => { log(`unhandledRejection: ${r?.stack || r}`) })

// ---- ② process.platform → 'linux' ----
Object.defineProperty(process, 'platform', { value: 'linux', configurable: false, writable: false })
log('stub: platform = linux')

// ---- ③ process.title 打桩 ----
try {
  let title = process.title
  Object.defineProperty(process, 'title', { get: () => title, set: (v) => { title = v }, configurable: true })
} catch (e) { log(`stub-skip: process.title(${e?.message})`) }

// ---- ④ process.resourcesPath:首亮实测天然正确(/data/storage/el1/bundle/entry/resources/resfile/resources),
//        仅异常布局才 defineProperty 兜底(该属性 defineProperty 疑似触发 native 异常,勿轻碰)----
let rawRp = 'unreadable'
try { rawRp = process.resourcesPath } catch {}
PROBES.rawResourcesPath = rawRp
if (typeof rawRp === 'string' && path.resolve(rawRp) === path.resolve(RESOURCES_DIR)) {
  log(`stub: resourcesPath 天然正确(${rawRp}),跳过重定义`)
} else {
  try { Object.defineProperty(process, 'resourcesPath', { value: RESOURCES_DIR, configurable: true }) }
  catch (e) {
    try { Object.defineProperty(Object.getPrototypeOf(process), 'resourcesPath', { value: RESOURCES_DIR, configurable: true }) }
    catch (e2) { log(`FATAL: resourcesPath 打桩双失败:${e2?.message}`) }
  }
  log(`stub: process.resourcesPath = ${process.resourcesPath}`)
}

// ---- ⑤ HOME/XDG/TMPDIR + chdir ----
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

const { app, powerMonitor, BrowserWindow, Tray, nativeImage } = await import('electron')

// ---- ⑤b 禁 renderer 沙箱(必须 ready 前;GPU 起而 renderer 未起的对冲,VSCodium 同款)----
try { app.commandLine.appendSwitch('disable-renderer-sandbox'); log('stub: disable-renderer-sandbox') } catch {}

// ---- ⑥ app.isPackaged 钉 true ----
PROBES.rawIsPackaged = app.isPackaged
if (app.isPackaged !== true) {
  let ok = false
  try { Object.defineProperty(app, 'isPackaged', { value: true, configurable: true }); ok = app.isPackaged === true } catch {}
  if (!ok) { try { Object.defineProperty(Object.getPrototypeOf(app), 'isPackaged', { value: true, configurable: true }); ok = app.isPackaged === true } catch {} }
  if (!ok) log('FATAL: isPackaged 打桩双失败(启用 --pin-packaged 后处理)')
}
log(`stub: app.isPackaged(raw=${PROBES.rawIsPackaged} → ${app.isPackaged})`)

// ---- ⑦ documents 可写探测 + 降级(default-save-dir throw 点)----
try {
  const docDir = app.getPath('documents')
  const probe = path.join(docDir, 'GenOffice')
  fs.mkdirSync(probe, { recursive: true })
  const f = path.join(probe, '.go-write-probe')
  fs.writeFileSync(f, 'ok'); fs.unlinkSync(f)
  log(`documents: 系统目录可写(${docDir}),不降级`)
} catch (e) {
  try {
    const fallback = path.join(EL2, 'Documents')
    fs.mkdirSync(fallback, { recursive: true })
    app.setPath('documents', fallback)
    log(`documents: 降级 → ${fallback}(${e?.message})`)
  } catch (e2) { log(`documents 降级失败:${e2?.message}`) }
}

// ---- ⑧ 单实例三 API(实测 raw returns:true;打桩一致)----
try { PROBES.rawSingleInstanceLock = `returns:${app.requestSingleInstanceLock({ probe: 1 })}` } catch (e) { PROBES.rawSingleInstanceLock = `throws:${e?.message}` }
app.requestSingleInstanceLock = () => true
app.hasSingleInstanceLock = () => true
app.releaseSingleInstanceLock = () => true

// ---- ⑨ powerMonitor 吞异常 ----
try {
  for (const m of ['addListener', 'on', 'once', 'removeListener', 'off', 'prependListener']) {
    const orig = powerMonitor?.[m]
    if (typeof orig === 'function') {
      powerMonitor[m] = (...a) => { try { return orig.apply(powerMonitor, a) } catch (e) { log(`powerMonitor.${m} swallowed: ${e?.message}`) } }
    }
  }
} catch (e) { log(`powerMonitor wrap failed: ${e?.message}`) }

// ---- ⑩ WCO 三 API 打桩 ----
for (const m of ['setTitleBarOverlay', 'setWindowButtonVisibility', 'setWindowButtonPosition']) {
  if (typeof BrowserWindow.prototype[m] === 'function') {
    const orig = BrowserWindow.prototype[m]
    BrowserWindow.prototype[m] = function (...a) { try { return orig.apply(this, a) } catch {} }
  } else {
    BrowserWindow.prototype[m] = function () {}
  }
}
app.on('browser-window-created', (_e, win) => {
  for (const m of ['setTitleBarOverlay', 'setWindowButtonVisibility', 'setWindowButtonPosition']) {
    if (typeof win[m] !== 'function') win[m] = function () {}
  }
})

// ---- ⑪ sidecar spawn 重映射(bundle 以属性访问形态调 child_process.spawn,先 patch 后加载即生效)----
const SIDECAR_BUNDLED = path.join(RESOURCES_DIR, 'native', 'xlsx-sidecar')
try { fs.accessSync(SIDECAR_RUNTIME, fs.constants.F_OK); log(`sidecar runtime 可达:${SIDECAR_RUNTIME}`) }
catch { log(`FATAL: sidecar 运行期路径不可达 ${SIDECAR_RUNTIME}`) }
try {
  const { createRequire } = await import('node:module')
  const nodeReq = createRequire(path.join(APP_DIR, 'package.json'))
  const cp = nodeReq('node:child_process')
  for (const fn of ['spawn', 'spawnSync']) {
    const orig = cp[fn]
    if (typeof orig !== 'function') continue
    cp[fn] = function (cmd, ...rest) {
      if (typeof cmd === 'string' && (cmd === SIDECAR_BUNDLED || cmd.endsWith('/native/xlsx-sidecar'))) {
        log(`spawn remap hit: ${fn} → ${SIDECAR_RUNTIME}`)
        return orig.call(cp, SIDECAR_RUNTIME, ...rest)
      }
      return orig.call(cp, cmd, ...rest)
    }
  }
  log('stub: sidecar spawn remap installed')
} catch (e) { log(`spawn remap 安装失败:${e?.message}`) }

// ---- ⑬ hidden WebContentsView 移出屏幕(死区排查 2026-09-21)----
// 症状:docs tab 打开后 ribbon"插入~视图"选项卡对系统输入(触屏/鼠标)无响应,
//       CDP 合成输入正常;事件在 fork 输入管线中消失(所有 view 的 pointerdown 均未触发)。
// 假设:fork 上 hidden 的 WebContentsView 仍参与命中测试拦截输入(tab-manager 有
//       spare sheets view 常驻 hidden,且 activateTab 只 setBounds active view,
//       非 active view 的 bounds 冻结在创建时刻——见 tab-manager.ts L394/L130)。
// 手段:周期扫描把 visible=false 的 view 平移出屏幕(-30000),setBounds 在
//       activateTab 恢复时会被 shell 重设,不冲突;观察死区是否消失以定真凶。
try {
  const { BrowserWindow } = await import('electron')
  const PARK = { x: -30000, y: 0, width: 10, height: 10 }
  const parkHidden = () => {
    for (const win of BrowserWindow.getAllWindows()) {
      for (const v of win.contentView?.children ?? []) {
        try { if (typeof v.getVisible === 'function' && !v.getVisible() && v.setBounds) v.setBounds(PARK) } catch {}
      }
    }
  }
  setInterval(parkHidden, 1000)
  app.on('browser-window-created', () => setTimeout(parkHidden, 300))
  log('stub: hidden-view parking installed(1s scan)')
} catch (e) { log(`hidden-view parking 安装失败:${e?.message}`) }

// ---- ⑭ 剪贴板读侧静默(pptx 反复弹窗排查 2026-09-21)----
// 症状:打开 pptx 反复弹"无法访问系统剪贴板"。机制:slides renderer 在 mount+focus
//       时调 clipboardProbe → 主进程 clipboard.availableFormats()/readText() →
//       fork 走 @ohos.pasteboard,READ_PASTEBOARD 未授权时触发系统提示弹窗;
//       弹窗关闭 → 窗口重新 focus → 又 probe → 死循环。
// 手段:读侧桩空(与 ACL 裁剪后的降级语义一致),写侧保留;M2 申请下
//       READ_PASTEBOARD 后按探测结果放行(见 M1_ACCEPTANCE §4)。
try {
  const { clipboard, nativeImage } = await import('electron')
  if (clipboard) {
    const emptyReturn = {
      availableFormats: () => [],
      readText: () => '',
      readHTML: () => '',
      readRTF: () => '',
      readBuffer: () => Buffer.alloc(0),
      readImage: () => (nativeImage ? nativeImage.createEmpty() : undefined),
      has: () => false,
    }
    for (const [m, fn] of Object.entries(emptyReturn)) {
      if (typeof clipboard[m] === 'function') { try { clipboard[m] = fn } catch {} }
    }
    log('stub: clipboard 读侧静默(availableFormats/readText/readImage/... → 空)')
  }
} catch (e) { log(`clipboard 桩安装失败:${e?.message}`) }

// ---- ⑫(预案)Tray 兜底 ----
if (process.env.GO_SHIM_TRAY === '1') {
  try { new Tray(nativeImage.createFromPath(path.join(RESOURCES_DIR, 'app', 'icon.png'))); log('tray: GO_SHIM_TRAY 兜底已建') }
  catch (e) { log(`tray: 兜底失败 ${e?.message}`) }
}

// ---- ⑭ 装载主 bundle(CJS,经 createRequire;勿用 dynamic import——ESM 语境会炸)----
log('=== shim done, loading out/main/index.js ===')
try {
  const { createRequire } = await import('node:module')
  const req = createRequire(path.join(APP_DIR, 'package.json'))
  req(path.join(APP_DIR, 'out', 'main', 'index.js'))
  log('out/main/index.js loaded')
} catch (e) {
  log(`out/main/index.js FAILED: ${e?.stack || e}`)
  try { app.quit() } catch {}
}
