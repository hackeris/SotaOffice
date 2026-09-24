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
// 日志三路:①沙箱文件(hdc 读不到) ②公共 Documents(仅三目录 ACL 到位才写成功——
// 既当日志通道,也是**ACL 生效的实证**) ③console→hilog(会被 flowcontrol 丢)
const LOG_PUBLIC = '/storage/Users/currentUser/Documents/GenOffice/shim-log.txt'
const log = (m) => {
  const line = `${new Date().toISOString()} ${m}\n`
  for (const p of [LOG, LOG_PUBLIC]) {
    try { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.appendFileSync(p, line) } catch {}
  }
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

// ---- ⑤b 禁 renderer 沙箱(必须 ready 前;GPU 起而 renderer 未起的对冲)----
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

// ---- ⑦ 系统目录(documents/downloads/desktop)可写探测 + 降级 ----
// 三目录 ACL 到手后系统目录天然可写(探测通过则不干预);未到手时写入抛错会让
// 保存链断裂,故逐个探测并把不可写的 setPath 降级到 el2(功能不中断)。
// documents 多探一层 GenOffice 子目录——应用的文件落点在那里。
PROBES.paths = {}
PROBES.pathWritable = {}
for (const [name, sub, fb] of [
  ['documents', 'GenOffice', 'Documents'],
  ['downloads', '', 'Download'],
  ['desktop', '', 'Desktop'],
]) {
  try {
    const dir = app.getPath(name)
    const probeDir = sub ? path.join(dir, sub) : dir
    fs.mkdirSync(probeDir, { recursive: true })
    const f = path.join(probeDir, '.go-write-probe')
    fs.writeFileSync(f, 'ok'); fs.unlinkSync(f)
    PROBES.paths[name] = dir
    PROBES.pathWritable[name] = 'system'
    log(`${name}: 系统目录可写(${dir}),不降级`)
  } catch (e) {
    try {
      const fallback = path.join(EL2, fb)
      fs.mkdirSync(fallback, { recursive: true })
      app.setPath(name, fallback)
      PROBES.paths[name] = fallback
      PROBES.pathWritable[name] = `fallback(${e?.code ?? ''}${e?.message ?? e})`
      log(`${name}: 降级 → ${fallback}(${e?.message})`)
    } catch (e2) { log(`${name} 降级失败:${e2?.message}`) }
  }
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

// ---- ⑭ 剪贴板读侧静默(授权信号文件恢复制,2026-09-22 v2)----
// 背景:未授权时读侧任一原生调用触发系统"无法访问系统剪贴板"弹窗(slides 在
// mount+focus 时 probe → 弹窗关闭 → focus 回归 → 再 probe = 死循环,2026-09-21 修复)。
// 教训(2026-09-22):曾改"自证式探测"(写标记+原生 readText 读回),但**未授权时调用
// 原生 readText 本身就会弹系统窗**——回归时 sheets 打开即弹。故 v2:**未获授权信号
// 绝不调用原生读侧**。
// 授权信号由 entry EntryAbility(ArkTS,能 checkAccessToken/requestPermissions)写
// clip-perm.json;shim 轮询该文件:granted=true → 恢复原读侧;false/超时 → 永久静默。
// 写侧始终不受影响。
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
    const orig = {}
    for (const [m, fn] of Object.entries(emptyReturn)) {
      if (typeof clipboard[m] === 'function') {
        orig[m] = clipboard[m]
        try { clipboard[m] = fn } catch {}
      }
    }
    log('stub: clipboard 读侧静默(等待授权信号文件)')
    // 信号文件由 EntryAbility 写(路径须与 ArkTS 侧一致);轮询 3s × 20 次(60s)。
    // 读到 granted=false 立即停(用户已拒/未声明);超时也停(保持静默,有界)。
    const GRANT_FILE = '/data/storage/el2/base/files/clip-perm.json'
    let tries = 0
    const checkGrant = () => {
      tries++
      let verdict = null
      try { verdict = JSON.parse(fs.readFileSync(GRANT_FILE, 'utf8')) } catch {}
      if (verdict?.granted === true) {
        for (const [m, fn] of Object.entries(orig)) { try { clipboard[m] = fn } catch {} }
        PROBES.clipGrant = 'granted'
        log('stub: clipboard 读侧已恢复(授权信号确认)')
        return
      }
      if (verdict?.granted === false) {
        PROBES.clipGrant = 'denied'
        log('stub: clipboard 授权信号=未授予,读侧永久静默')
        return
      }
      if (tries < 20) setTimeout(checkGrant, 3000)
      else { PROBES.clipGrant = 'timeout'; log('stub: clipboard 授权信号超时未到,读侧保持静默') }
    }
    app.whenReady().then(() => setTimeout(checkGrant, 3000))
  }
} catch (e) { log(`clipboard 桩安装失败:${e?.message}`) }

// ---- ⑮ 系统按钮避让(shell tab 条右端与三按钮重叠,2026-09-23)----
// 桌面 Electron 把窗口按钮区信息以 CSS env(titlebar-area-*) 交给应用(WCO),
// 应用按它让出右上角(shell tabbar.css 的 .tab-bar-caption-spacer);OHOS 引擎不
// 提供该变量 → 应用算出的避让宽度恒为 0 → 重叠。真值由 entry(ArkTS,
// windowTitleButtonRectChange)落 title-button-rect.json,这里注入等效 CSS;
// 周期重读,窗口 resize / 按钮显隐变化后自愈(值不变则不重复注入)。
const CAPTION_RECT_FILE = '/data/storage/el2/base/files/title-button-rect.json'
app.on('web-contents-created', (_e, wc) => {
  let lastCss = ''
  let lastKey = null
  const apply = () => {
    let css = ''
    try {
      const r = JSON.parse(fs.readFileSync(CAPTION_RECT_FILE, 'utf8'))
      // right/width 语义(距窗口右缘)不明确,取较大者兜底
      const w = Math.max(Number(r.width) || 0, Number(r.right) || 0)
      if (w > 0) css = `.tab-bar-caption-spacer { width: ${Math.ceil(w)}px !important; }`
    } catch { /* 文件未就绪:保持应用原样(等价于无按钮区) */ }
    if (!css || css === lastCss) return
    lastCss = css
    const prev = lastKey
    wc.insertCSS(css)
      .then((k) => { lastKey = k; if (prev) wc.removeInsertedCSS(prev).catch(() => {}) })
      .catch(() => { lastCss = '' })
  }
  wc.on('dom-ready', apply)
  setInterval(apply, 2000)
})
log('stub: caption-avoidance injector installed')

// ---- ⑯ 探针上报(2026-09-24)----
// 沙箱文件 hdc 读不到、hilog 会 flowcontrol 丢日志,唯一可靠通道是 CDP:
// 周期把 PROBES(三目录落点/可写性、剪贴板授权信号、平台等)注入 shell 页,
// 排障时 `window.__GO_INFO__` 一读即得。
app.on('browser-window-created', (_e, win) => {
  const wc = win.webContents
  const push = () => {
    try { wc.executeJavaScript(`window.__GO_INFO__ = ${JSON.stringify(PROBES)}`, true).catch(() => {}) } catch {}
  }
  wc.on('dom-ready', push)
  setInterval(push, 2000)
})
log('stub: probes injector installed')

// ---- ⑰ 运行时打开文档(热启动,2026-09-24)----
// 应用已在运行时打开文件:系统复用 Ability 实例(走 onNewWant),而引擎只在启动期
// 消费 cmdArgs → EntryAbility 把路径写 open-doc.json,这里轮询并经**应用自带的
// control-server**(control.sock,JSON lines + token)发 open 命令,在现有窗口打开。
// 凭据文件 <userData>/control.json 由应用启动 control-server 时写出。
const OPEN_DOC_FILE = '/data/storage/el2/base/files/open-doc.json'
try {
  const net = await import('node:net')
  let lastSeq = 0
  const openViaControl = (docPath) => {
    const info = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'control.json'), 'utf8'))
    const sock = net.connect(info.endpoint)
    let buf = ''
    sock.setEncoding('utf8')
    sock.setTimeout(15000, () => sock.destroy())
    sock.on('error', (e) => log(`open-doc: control error ${e?.message}`))
    sock.on('connect', () => sock.write(
      JSON.stringify({ token: info.token, request: { cmd: 'open', path: docPath } }) + '\n'))
    sock.on('data', (c) => {
      buf += c
      const nl = buf.indexOf('\n')
      if (nl < 0) return
      log(`open-doc: reply ${buf.slice(0, nl)}`)
      sock.destroy()
    })
  }
  setInterval(() => {
    let sig = null
    try { sig = JSON.parse(fs.readFileSync(OPEN_DOC_FILE, 'utf8')) } catch { return }
    if (!sig?.path || !sig.seq || sig.seq === lastSeq) return
    lastSeq = sig.seq
    log(`open-doc: signal -> ${sig.path}`)
    try { openViaControl(sig.path) } catch (e) { log(`open-doc: ${e?.message}`) }
  }, 1500)
  log('stub: runtime-open-document installed')
} catch (e) { log(`open-doc 桩安装失败:${e?.message}`) }

// ---- ⑱ 真机测试文件生成(B2-B6 文件关联抽验专用;发布前移除)----
// 由来:文件关联必须有公共目录里的真实文件,但 hdc 侧一律写不进去(2026-09-24 实测):
//   `ls /storage/Users` 在 shell 命名空间报 No such file or directory,
//   `hdc file send` 到同一路径报 "Error opening file: no such file or directory"
//   —— 公共用户区对 shell 不可见。shim 跑在应用进程内,有公共目录写权(日志已证)。
// 产物:Desktop/probe.{md,html,txt,pdf,docx,xlsx,pptx};已存在则跳过(幂等)。
// 关闭:GO_TEST_FILES=0。
if (process.env.GO_TEST_FILES !== '0') {
  try {
    const DESKTOP = '/storage/Users/currentUser/Desktop'
    fs.mkdirSync(DESKTOP, { recursive: true })
    const made = []
    const writeIfAbsent = (name, data) => {
      const p = path.join(DESKTOP, name)
      if (fs.existsSync(p)) return
      fs.writeFileSync(p, data)
      made.push(name)
    }

    // 纯文本类:内容本身就是有效文档
    writeIfAbsent('probe.md', Buffer.from('# 探针文档\n\n用于文件关联抽验(markdown)。\n'))
    writeIfAbsent('probe.txt', Buffer.from('用于验证未知类型回落的纯文本。\n'))
    writeIfAbsent(
      'probe.html',
      Buffer.from(
        '<!doctype html><html><head><meta charset="utf-8"><title>probe</title></head>' +
          '<body><h1>探针文档</h1><p>用于文件关联抽验(html)。</p></body></html>\n',
      ),
    )

    // 最小合法 PDF:xref 各条偏移必须等于该对象在文件中的真实字节位置
    const pdfBody = 'BT /F1 14 Tf 20 50 Td (probe) Tj ET'
    const pdfObjs = [
      '1 0 obj\n<</Type/Catalog/Pages 2 0 R>>\nendobj\n',
      '2 0 obj\n<</Type/Pages/Kids[3 0 R]/Count 1>>\nendobj\n',
      '3 0 obj\n<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 120]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>\nendobj\n',
      `4 0 obj\n<</Length ${pdfBody.length}>>\nstream\n${pdfBody}\nendstream\nendobj\n`,
      '5 0 obj\n<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>\nendobj\n',
    ]
    {
      let out = '%PDF-1.4\n'
      const offs = [0]
      for (const o of pdfObjs) {
        offs.push(Buffer.byteLength(out, 'latin1'))
        out += o
      }
      const xref = Buffer.byteLength(out, 'latin1')
      out += `xref\n0 ${pdfObjs.length + 1}\n0000000000 65535 f \n`
      for (let i = 1; i <= pdfObjs.length; i++) {
        out += String(offs[i]).padStart(10, '0') + ' 00000 n \n'
      }
      out += `trailer\n<</Size ${pdfObjs.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`
      writeIfAbsent('probe.pdf', Buffer.from(out, 'latin1'))
    }

    // 最小 OOXML:zip 用 stored(不压缩)模式,避开 zlib 依赖
    const crcTable = (() => {
      const t = new Int32Array(256)
      for (let n = 0; n < 256; n++) {
        let c = n
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
        t[n] = c
      }
      return t
    })()
    const crc32 = (buf) => {
      let c = -1
      for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ crcTable[(c ^ buf[i]) & 0xff]
      return (c ^ -1) >>> 0
    }
    const zipStore = (entries) => {
      const parts = []
      const central = []
      let offset = 0
      for (const [name, content] of entries) {
        const nameBuf = Buffer.from(name, 'utf8')
        const data = Buffer.from(content, 'utf8')
        const crc = crc32(data)
        const local = Buffer.alloc(30)
        local.writeUInt32LE(0x04034b50, 0)
        local.writeUInt16LE(20, 4)
        local.writeUInt32LE(crc, 14)
        local.writeUInt32LE(data.length, 18)
        local.writeUInt32LE(data.length, 22)
        local.writeUInt16LE(nameBuf.length, 26)
        parts.push(local, nameBuf, data)
        const cd = Buffer.alloc(46)
        cd.writeUInt32LE(0x02014b50, 0)
        cd.writeUInt16LE(20, 4)
        cd.writeUInt16LE(20, 6)
        cd.writeUInt32LE(crc, 16)
        cd.writeUInt32LE(data.length, 20)
        cd.writeUInt32LE(data.length, 24)
        cd.writeUInt16LE(nameBuf.length, 28)
        cd.writeUInt32LE(offset, 42)
        central.push(cd, nameBuf)
        offset += local.length + nameBuf.length + data.length
      }
      const cdBuf = Buffer.concat(central)
      const end = Buffer.alloc(22)
      end.writeUInt32LE(0x06054b50, 0)
      end.writeUInt16LE(entries.length, 8)
      end.writeUInt16LE(entries.length, 10)
      end.writeUInt32LE(cdBuf.length, 12)
      end.writeUInt32LE(offset, 16)
      return Buffer.concat([...parts, cdBuf, end])
    }
    const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    const REL_NS = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"'
    const CT_NS = 'xmlns="http://schemas.openxmlformats.org/package/2006/content-types"'
    const REL_DEFAULTS =
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>'
    const rootRels = (target) =>
      `${XML_DECL}<Relationships ${REL_NS}><Relationship Id="rId1" ` +
      `Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" ` +
      `Target="${target}"/></Relationships>`

    writeIfAbsent(
      'probe.docx',
      zipStore([
        [
          '[Content_Types].xml',
          `${XML_DECL}<Types ${CT_NS}>${REL_DEFAULTS}` +
            '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
        ],
        ['_rels/.rels', rootRels('word/document.xml')],
        [
          'word/document.xml',
          `${XML_DECL}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
            '<w:body><w:p><w:r><w:t>探针文档 (docx)</w:t></w:r></w:p></w:body></w:document>',
        ],
      ]),
    )
    writeIfAbsent(
      'probe.xlsx',
      zipStore([
        [
          '[Content_Types].xml',
          `${XML_DECL}<Types ${CT_NS}>${REL_DEFAULTS}` +
            '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
            '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
        ],
        ['_rels/.rels', rootRels('xl/workbook.xml')],
        [
          'xl/workbook.xml',
          `${XML_DECL}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
            '<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>',
        ],
        [
          'xl/_rels/workbook.xml.rels',
          `${XML_DECL}<Relationships ${REL_NS}><Relationship Id="rId1" ` +
            'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" ' +
            'Target="worksheets/sheet1.xml"/></Relationships>',
        ],
        [
          'xl/worksheets/sheet1.xml',
          `${XML_DECL}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
            '<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>probe</t></is></c></row></sheetData></worksheet>',
        ],
      ]),
    )
    writeIfAbsent(
      'probe.pptx',
      zipStore([
        [
          '[Content_Types].xml',
          `${XML_DECL}<Types ${CT_NS}>${REL_DEFAULTS}` +
            '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
            '<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>',
        ],
        ['_rels/.rels', rootRels('ppt/presentation.xml')],
        [
          'ppt/presentation.xml',
          `${XML_DECL}<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
            'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
            '<p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>' +
            '<p:sldSz cx="9144000" cy="6858000"/></p:presentation>',
        ],
        [
          'ppt/_rels/presentation.xml.rels',
          `${XML_DECL}<Relationships ${REL_NS}><Relationship Id="rId1" ` +
            'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" ' +
            'Target="slides/slide1.xml"/></Relationships>',
        ],
        [
          'ppt/slides/slide1.xml',
          `${XML_DECL}<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
            'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
            '<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
            '<p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>' +
            '<p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>probe</a:t></a:r></a:p></p:txBody>' +
            '</p:sp></p:spTree></p:cSld></p:sld>',
        ],
      ]),
    )

    PROBES.testFiles = made
    log(made.length ? `test-files: 已生成 ${made.join(', ')}` : 'test-files: 均存在,跳过')
  } catch (e) {
    log(`test-files 桩失败:${e?.message}`)
  }
}

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
