// main.mjs —— GenOffice Electron-OHOS 自检主进程(POC-0/3/4/5 真机疑点一页验完)
//
// 疑点映射(docs/ELECTRON_OHOS_CHECKLIST.md):
//   装载链全通 ......... 窗口点亮本身(自定义 scheme 渲染 = protocol 管线验证)
//   A1 platform ........ selfcheck:probe(shim 打桩前原始值)
//   A2 单实例 .......... selfcheck:probe(裸调真实返回值/是否抛)
//   A3 路径 ............ selfcheck:env(app.getPath 全家 + cwd/execPath)
//   A4 clipboard ....... selfcheck:clipboard
//   A5 printToPDF ...... selfcheck:printToPDF(纯 Chromium 管线,官方标支持)
//   A6 WCO 打桩 ........ selfcheck:wco(打桩后不崩 = shim 生效)
//   A7 spawn sidecar ... selfcheck:sidecar(executableBinaryPaths + XPM 放行 + spawn 通路)
//   A8 wasm pdfium ..... selfcheck:wasm(POC-5 真机 spot check;坚盾模式下此项 FAIL 属预期)
//   A9 Tray ............ selfcheck:tray(官方"窗口与托盘强绑定"验证)
//   人工观察 ........... 自检页顶部 checklist(三键/IME/拖拽/托盘图标)
import { app, BrowserWindow, ipcMain, protocol, clipboard, nativeImage, Tray, net } from 'electron'
import { spawn } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const HERE = path.dirname(new URL(import.meta.url).pathname) // resfile/resources/app
const SIDECAR = '/data/storage/el1/bundle/libs/arm64/xlsx-sidecar' // 运行期路径(清单 §0:无 -v8a)
const log = (m) => { try { appendFileSync('/data/storage/el2/base/files/shim-log.txt', `${new Date().toISOString()} [main] ${m}\n`) } catch {} }

// 自定义 scheme(必须在 app ready 前;GenOffice 4 scheme 管线代表)
protocol.registerSchemesAsPrivileged([
  { scheme: 'genoffice-app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
])

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------- A7:spawn sidecar ----------
function runSidecar() {
  return new Promise((resolve) => {
    let out = '', err = '', settled = false
    const done = (ok, detail) => { if (!settled) { settled = true; try { child.kill() } catch {}; resolve({ ok, detail }) } }
    let child
    try {
      child = spawn(SIDECAR, ['--selfcheck'], { stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (e) {
      return resolve({ ok: false, detail: `spawn threw: ${e?.message}` })
    }
    const t = setTimeout(() => done(true, `alive-silent(3s,exec+spawn OK;协议层 host 已验)\nstdout:${out}\nstderr:${err}`), 3000)
    child.stdout?.on('data', (d) => { out += d; done(true, `stdout: ${out.trim().slice(0, 200)}`) })
    child.stderr?.on('data', (d) => { err += d })
    child.on('error', (e) => { clearTimeout(t); done(false, `error event: ${e?.message}(XPM 拦截/executableBinaryPaths 疑点)`) })
    child.on('close', (code, sig) => { clearTimeout(t); done(false, `exited code=${code} sig=${sig}\nstdout:${out}\nstderr:${err}`) })
  })
}

// ---------- A8:wasm pdfium(POC-5 脚本移植)----------
async function runWasm() {
  const wasmPath = path.join(HERE, 'wasm/pdfium.wasm')
  const raw = readFileSync(wasmPath)
  const wasmBinary = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)
  const req = createRequire(path.join(HERE, 'package.json'))
  const { init } = req('./wasm/pdfium.cjs')
  const wrapped = await init({ wasmBinary, thisProgram: 'go-selfcheck' })
  const m = 'pdfium' in wrapped ? wrapped.pdfium : wrapped
  m._PDFiumExt_Init()
  const pdf = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 44>>stream
BT /F1 24 Tf 72 720 Td (Hello GenOffice OHOS) Tj ET
endstream
endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R/Size 6>>
`
  const data = Buffer.from(pdf, 'latin1')
  const docPtr = m._malloc(data.length)
  m.HEAPU8.set(data, docPtr)
  const doc = m._FPDF_LoadMemDocument(docPtr, data.length, 0)
  if (!doc) throw new Error(`LoadMemDocument failed, err=${m._FPDF_GetLastError()}`)
  const pages = m._FPDF_GetPageCount(doc)
  const page = m._FPDF_LoadPage(doc, 0)
  const tp = m._FPDFText_LoadPage(page)
  const n = m._FPDFText_CountChars(tp)
  const buf = m._malloc((n + 1) * 2)
  const got = m._FPDFText_GetText(tp, 0, n, buf)
  let text = ''
  for (let i = 0; i < got - 1; i++) text += String.fromCharCode(m.HEAPU16[(buf >> 1) + i])
  return { ok: true, detail: `init OK;pageCount=${pages};text=${JSON.stringify(text)}(wasm/JIT 可用)` }
}

// ---------- 窗口 ----------
let win = null
function createWindow() {
  win = new BrowserWindow({
    width: 1180, height: 860,
    frame: false, // GenOffice 真实形态:frameless + WCO(自检页人工观察三键缺失)
    webPreferences: {
      preload: path.join(HERE, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  win.loadURL('genoffice-app://selfcheck/index.html')
  win.webContents.on('did-fail-load', (_e, code, desc, url) => log(`did-fail-load ${code} ${desc} ${url}`))
}

let tray = null
function createTray() {
  try {
    tray = new Tray(nativeImage.createFromPath(path.join(HERE, 'icon.png')))
    return { ok: true, detail: 'Tray created(官方:窗口显隐与托盘强绑定)' }
  } catch (e) {
    return { ok: false, detail: `Tray failed: ${e?.message}` }
  }
}

// ---------- IPC:自检项 ----------
ipcMain.handle('selfcheck:probe', () => {
  const P = globalThis.__GO_PROBES__ || {}
  return {
    rawPlatform: P.rawPlatform,
    rawSingleInstanceLock: P.rawSingleInstanceLock,
    stubbedPlatform: process.platform,
    versions: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node },
  }
})
ipcMain.handle('selfcheck:env', () => {
  const paths = {}
  for (const k of ['home', 'appData', 'userData', 'temp', 'exe', 'downloads', 'documents', 'desktop']) {
    try { paths[k] = app.getPath(k) } catch (e) { paths[k] = `ERR:${e?.message}` }
  }
  return { paths, cwd: process.cwd(), execPath: process.execPath, HOME: process.env.HOME, arch: process.arch, osType: require_node_os() }
})
ipcMain.handle('selfcheck:clipboard', async () => {
  const mark = `go-selfcheck-${Date.now()}`
  clipboard.writeText(mark)
  await sleep(50)
  const got = clipboard.readText()
  const img = clipboard.readImage() // 空 clipboard 上不崩即可
  return { ok: got === mark, detail: `write/read:${got === mark ? 'PASS' : `MISMATCH(${got})`};readImage:${img?.getSize ? 'ok' : 'err'}(size=${JSON.stringify(img?.getSize?.())})` }
})
ipcMain.handle('selfcheck:printToPDF', async () => {
  try {
    const buf = await win.webContents.printToPDF({ printBackground: true })
    return { ok: buf?.length > 100 && buf.slice(0, 5).toString() === '%PDF-', detail: `printToPDF ${buf?.length} bytes, head=${buf.slice(0, 8).toString('latin1')}` }
  } catch (e) { return { ok: false, detail: `printToPDF failed: ${e?.message}` } }
})
ipcMain.handle('selfcheck:wco', () => {
  try {
    win.setTitleBarOverlay({ color: '#FF0000' })
    win.setWindowButtonVisibility(true)
    return { ok: true, detail: '打桩后调用不抛(shim 生效);窗口视觉无变化属预期(fork 无 WCO)' }
  } catch (e) { return { ok: false, detail: `WCO threw: ${e?.message}(shim 未生效!)` } }
})
ipcMain.handle('selfcheck:sidecar', async () => {
  try { return await runSidecar() } catch (e) { return { ok: false, detail: `${e?.stack || e}` } }
})
ipcMain.handle('selfcheck:wasm', async () => {
  try { return await runWasm() } catch (e) {
    return { ok: false, detail: `${e?.message}(若设备开坚盾守护模式:JIT/wasm 全禁,此项 FAIL 属预期——清单 §8)` }
  }
})
ipcMain.handle('selfcheck:tray', () => tray ? { ok: true, detail: 'Tray 存在' } : createTray())
ipcMain.handle('selfcheck:native-image', () => {
  const img = nativeImage.createFromPath(path.join(HERE, 'icon.png'))
  const s = img.getSize()
  return { ok: s.width > 0, detail: `icon ${s.width}x${s.height}` }
})

function require_node_os() { try { return createRequire(path.join(HERE, 'package.json'))('node:os').type() } catch (e) { return `ERR:${e?.message}` } }

// ---------- 启动 ----------
app.whenReady().then(() => {
  log('app ready')
  protocol.handle('genoffice-app', (req) => {
    const url = new URL(req.url)
    // genoffice-app://selfcheck/index.html → HERE/index.html
    const rel = (url.hostname === 'selfcheck' ? url.pathname.slice(1) : (url.hostname + url.pathname).replace(/^\/+/, '')) || 'index.html'
    const file = path.join(HERE, rel.replace(/\.\./g, '_'))
    return net.fetch(pathToFileURL(file).toString())
  })
  createTray()
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
