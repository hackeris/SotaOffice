// ohos-smoke.mjs —— M1 真机 e2e smoke 最小集(9333 CDP 通道,Playwright-Electron 不可用的替代)
//
// 正确命令:node scripts/e2e/ohos-smoke.mjs [suite…](缺省 all)
//   suites: boot | home | markdown-edit | docs-open | docs-export-pdf | sheets-sidecar | pdf-wasm
// 前置:真机已装已启动 app;hdc fport tcp:9333 tcp:9333 已建立
// 依赖:根 package.json devDependencies.ws(正式仓自带,勿再借 .temp 解析)
// 输出:逐用例 PASS/FAIL + JSON 汇总;任一 FAIL 退出码 1
// 选择器来源:上游 e2e/home.spec.ts 稳定集(.home-hero/.quick-card×7/.tab-item)
// 明确不做(入册 R7,M2):视觉基线/多窗口/MCP/AI 面板
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
const req = createRequire(new URL('../../package.json', import.meta.url))
const WebSocket = req('ws')

const HDC = process.env.HDC || '/apps/harmony/sdk/default/openharmony/toolchains/hdc'
const TARGET = process.env.HDC_TARGET || '192.168.1.5:44959'
const BASE = 'http://127.0.0.1:9333'

const results = []
const record = (name, ok, detail) => { results.push({ name, ok, detail }); console.error(`${ok ? 'PASS' : 'FAIL'} ${name} — ${detail}`) }

async function targets() { return (await (await fetch(`${BASE}/json/list`)).json()).filter(t => t.type === 'page') }
async function openWS(url) {
  const ws = new WebSocket(url, { perMessageDeflate: false })
  let seq = 0; const pending = new Map()
  const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })) })
  ws.on('message', (d) => { const m = JSON.parse(d); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result) } })
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej) })
  return { ws, send, close: () => ws.close() }
}
const evalIn = async (c, expr) => (await c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value
const shell = (cmd) => execFileSync(HDC, ['-t', TARGET, 'shell', cmd], { encoding: 'utf8', timeout: 15000 })

// ---------- 用例 ----------
async function t_boot() {
  const ts = await targets()
  const home = ts.find(t => t.url.includes('index.html') || t.title.includes('Smart Office'))
  record('boot', !!home, `targets=${ts.length};first=${ts[0]?.title ?? 'none'}|${ts[0]?.url ?? ''}`)
}
async function t_home() {
  const ts = await targets()
  const home = ts.find(t => !t.url.startsWith('genoffice-app://')) || ts[0]
  const c = await openWS(home.webSocketDebuggerUrl)
  const hero = await evalIn(c, `!!document.querySelector('.home-hero')`)
  const cards = await evalIn(c, `document.querySelectorAll('.quick-card').length`)
  const shot = await c.send('Page.captureScreenshot', { format: 'png' })
  c.close()
  // 阈值 30KB:新装空数据态(最近列表空)实测 ~43KB,50KB 旧阈值误伤(2026-09-22)
  record('home', hero && cards >= 5 && shot.data.length > 30 * 1024, `hero=${hero};quick-cards=${cards};shot=${Math.round(shot.data.length / 1024)}KB(b64)`)
}
async function t_markdown_edit() {
  const ts = await targets()
  const md = ts.find(t => t.url.startsWith('genoffice-app://markdown'))
  if (!md) return record('markdown-edit', false, '无 markdown target(先在真机新建 markdown 文档)')
  const c = await openWS(md.webSocketDebuggerUrl)
  await c.send('Runtime.enable')
  // 选择器须 .ProseMirror 优先:markdown 页 DOM 序在前的 textarea(AI 输入框)会
  // 抢走通配匹配,insertText 落进输入框而非编辑器(2026-09-21 实测坑)
  await evalIn(c, `(document.querySelector('.ProseMirror,[contenteditable="true"]') ?? document.body).focus()`)
  await c.send('Input.insertText', { text: '鸿蒙 smoke 中文输入' })
  await new Promise(r => setTimeout(r, 500))
  const got = await evalIn(c, `document.body.innerText.includes('鸿蒙 smoke 中文输入')`)
  c.close()
  record('markdown-edit', got, `Input.insertText 后 DOM 命中=${got}`)
}
async function t_docs_open() {
  const ts = await targets()
  const doc = ts.find(t => t.url.startsWith('genoffice-app://docs'))
  record('docs-open', !!doc, doc ? `target=${doc.url.slice(0, 60)}` : '无 docs target(真机先打开一个 docx)')
}
async function t_docs_export_pdf() {
  const ts = await targets()
  const doc = ts.find(t => t.url.startsWith('genoffice-app://docs'))
  if (!doc) return record('docs-export-pdf', false, '无 docs target')
  const c = await openWS(doc.webSocketDebuggerUrl)
  // fork 无 CDP Page.printToPDF(2026-09-21 实测),改走应用 IPC docs:print-pdf-buffer
  // (主进程 webContents.printToPDF,无面板直返 base64,A4=11906x16838 twips)
  const r = await evalIn(c, `window.desktop && window.desktop.printPdfBuffer
    ? window.desktop.printPdfBuffer(11906, 16838).then(x => JSON.stringify(x)).catch(e => 'reject:' + e)
    : 'no-desktop-api'`)
  c.close()
  if (typeof r !== 'string' || !r.startsWith('{')) return record('docs-export-pdf', false, `IPC 返回异常:${String(r).slice(0, 60)}`)
  const parsed = JSON.parse(r)
  if (!parsed.ok) return record('docs-export-pdf', false, `printPdfBuffer 失败:${String(parsed.error).slice(0, 60)}`)
  const buf = Buffer.from(parsed.base64, 'base64')
  // 断言 PDF 结构有效:空白 A4 页 ~1KB、几十字短文档 ~61KB(2026-09-21/22 实测),
  // 内容量由 G4 人工轨保证,这里只验证导出链(printToPDF)结构正确
  record('docs-export-pdf', buf.length > 512 && buf.slice(0, 5).toString('latin1') === '%PDF-', `${Math.round(buf.length / 1024)}KB head=${buf.slice(0, 8).toString('latin1')}`)
}
async function t_sheets_sidecar() {
  const ts = await targets()
  const sheet = ts.find(t => t.url.startsWith('genoffice-app://sheets'))
  if (!sheet) return record('sheets-sidecar', false, '无 sheets target(真机先建表并保存一次触发 sidecar)')
  // 判据:Native 子进程存活即 PASS(统一包改走系统 Native 子进程后,进程由
  // appspawn fork,名字形如 <bundle>:Native_libxlsx_sidecar<N>;旧的 spawn 型
  // xlsx-sidecar ELF 已退役,继续 grep 它恒空 = 永久假红)
  let proc = ''
  try { proc = shell('ps -ef | grep Native_libxlsx_sidecar | grep -v grep | head -2') } catch {}
  record('sheets-sidecar', !!proc.trim(), `proc=${proc.trim() ? 'alive' : 'not-running(未触发或已退出)'};Native 子进程以 ps 为准`)
}
async function t_pdf_wasm() {
  const ts = await targets()
  const pdf = ts.find(t => t.url.startsWith('genoffice-app://pdf'))
  if (!pdf) return record('pdf-wasm', false, '无 pdf target(真机先打开一个 PDF)')
  const c = await openWS(pdf.webSocketDebuggerUrl)
  const pages = await evalIn(c, `(() => { const m = document.body.innerText.match(/(\\d+)\\s*\\/\\s*\\d+/); return m ? m[0] : document.querySelectorAll('canvas').length })()`)
  c.close()
  record('pdf-wasm', !!pages, `页码/画布指示=${pages}`)
}

const SUITES = { 'boot': t_boot, 'home': t_home, 'markdown-edit': t_markdown_edit, 'docs-open': t_docs_open, 'docs-export-pdf': t_docs_export_pdf, 'sheets-sidecar': t_sheets_sidecar, 'pdf-wasm': t_pdf_wasm }
const wanted = process.argv.slice(2).filter(a => !a.startsWith('-'))
const run = wanted.length ? wanted : Object.keys(SUITES)
for (const name of run) {
  if (!SUITES[name]) { record(name, false, '未知用例'); continue }
  try { await SUITES[name]() } catch (e) { record(name, false, `threw: ${e.message}`) }
}
console.log(JSON.stringify({ total: results.length, pass: results.filter(r => r.ok).length, results }, null, 1))
process.exit(results.some(r => !r.ok) ? 1 : 0)
