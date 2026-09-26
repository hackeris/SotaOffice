// six-type-regression.mjs —— 六类型文件设备级回归(xlsx/md/html/pdf;docx/pptx 见缺口)
//
// 正确命令:node scripts/e2e/six-type-regression.mjs <cdp-port>(pad=9333 / PC=9335)
// 前置:真机已装已启动 app;hdc fport 已映射;文档目录留有任一 .xlsx(打开素材,
//       无则脚本 FAIL 提示——用应用手动保存一个即可)
// 覆盖:xlsx 磁盘打开→引擎加载完成 / md·html 静默保存→关 tab→磁盘重开→内容命中 /
//       pdf 落盘+自动打开→页指示。全部经应用自身 IPC(window.aiOffice/preload API),零侵入
// 缺口(如实):docx·pptx 无设备级用例——hdc 写不进沙箱/公共目录,应用又无静默保存
//       通道(md/html/pdf 的静默保存是它们独有的产品功能);xlsx 写回需 renderer 会话 id,
//       生产包无此通道(上游 e2e 用 GENOFFICE_DEBUG_HOOKS=1 自建包,见 sheets preload)
// 关键姿势:保存走 preload IPC(绕过编辑器 state),tab 显示内容≠文件内容;openPath 对
//       已打开文件只前置不新开——凡验证"从磁盘打开",必先 close 同路径 tab;selection
//       依赖前台 activeWorkbook,断言工作簿状态要用加载文案而非 __genofficeControl
import { createRequire } from 'node:module'
const req = createRequire(new URL('../../package.json', import.meta.url))
const WebSocket = req('ws')

const BASE = `http://127.0.0.1:${process.argv[2] || '9333'}`
const results = []
const record = (name, ok, detail) => { results.push({ name, ok, detail }); console.error(`${ok ? 'PASS' : 'FAIL'} ${name} — ${detail}`) }
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

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

async function homeConn() {
  for (let i = 0; i < 20; i++) {
    const home = (await targets()).find(t => t.url.startsWith('file:///'))
    if (home) { const c = await openWS(home.webSocketDebuggerUrl); if (await evalIn(c, `!!window.aiOffice`)) return c; c.close() }
    await sleep(1000)
  }
  throw new Error('home 页无 window.aiOffice')
}
/** 清场:关掉所有文档 tab,只留 home(历轮堆积的 tab 会污染"新 target"判定) */
async function cleanupTabs(home) {
  await evalIn(home, `(async () => {
    const tabs = await window.aiOfficeTabs.list()
    for (const t of tabs) { if (t.closable) await window.aiOfficeTabs.close(t.id).catch(() => {}) }
    return 'ok'
  })()`)
  await sleep(1500)
}
/** 关掉已打开的同路径 tab(有 path 必不 dirty,无确认弹窗),返回是否关过 */
async function closeTabByPath(home, path) {
  return evalIn(home, `(async () => {
    const tabs = await window.aiOfficeTabs.list()
    const t = tabs.find(x => x.filePath === ${JSON.stringify(path)})
    if (!t) return 'no-tab'
    await window.aiOfficeTabs.close(t.id)
    return 'closed:' + t.id
  })()`)
}
/** 磁盘打开:清掉该 scheme 未命名空 tab + close 同路径 tab → openPath → 返回唯一新 target */
async function freshOpen(home, scheme, path) {
  const closeInfo = await evalIn(home, `(async () => {
    const tabs = await window.aiOfficeTabs.list()
    for (const t of tabs) {
      if (t.kind === ${JSON.stringify(scheme)} && !t.filePath) await window.aiOfficeTabs.close(t.id).catch(() => {})
    }
    const cur = tabs.find(x => x.filePath === ${JSON.stringify(path)})
    if (cur) await window.aiOfficeTabs.close(cur.id)
    return 'ok'
  })()`)
  await sleep(1000)
  const before = new Set((await targets()).map(t => t.webSocketDebuggerUrl))
  await evalIn(home, `window.aiOffice.openPath(${JSON.stringify(path)})`)
  const t0 = Date.now()
  while (Date.now() - t0 < 20000) {
    const fresh = (await targets()).filter(t => t.url.startsWith(`genoffice-app://${scheme}`) && !before.has(t.webSocketDebuggerUrl))
    if (fresh.length) return fresh[fresh.length - 1]
    await sleep(700)
  }
  return null
}
const attach = (t) => openWS(t.webSocketDebuggerUrl)
const pageClean = async (c) => {
  const txt = await evalIn(c, `document.body.innerText.slice(0, 4000)`)
  return { clean: !/Error invoking|加载失败|无法打开/.test(String(txt)), sample: String(txt).replace(/\s+/g, ' ').slice(0, 120) }
}

// ---------- xlsx:磁盘打开 + selection 往返 ----------
async function t_xlsx(home) {
  // 素材:默认保存目录优先;空目录(新装/刚换目录名)回退最近列表里任意 xlsx 路径。
  // 已打开的文件不能选——close 会触发未保存确认框导致 tab 关不掉,后续断言全歪
  const openPaths = JSON.parse(await evalIn(home, `(async () => {
    const tabs = await window.aiOfficeTabs.list()
    return JSON.stringify(tabs.map(t => t.filePath).filter(Boolean))
  })()`))
  const root = JSON.parse(await evalIn(home, `(async () => JSON.stringify(await window.aiOffice.folderRoot()))()`)).path
  const list = JSON.parse(await evalIn(home, `(async () => JSON.stringify(await window.aiOffice.listFolder(${JSON.stringify(root)})))()`))
  let xlsx = list.files.find(f => f.ext === 'xlsx' && !openPaths.includes(f.path))
  if (!xlsx) {
    // 最近列表在沙箱下常见路径失效(文件已删/目录更名):statPaths 仍返回条目
    // 但带 missing:true、sizeBytes:0,必须按 missing 过滤
    const recentPath = await evalIn(home, `(async () => {
      const page = await window.aiOffice.recents({ ext: 'xlsx', limit: 50 })
      const open = ${JSON.stringify(openPaths)}
      const candidates = (page.entries || []).map(e => e.path).filter(p => p && !open.includes(p))
      const stat = await window.aiOffice.statPaths(candidates)
      const alive = (stat || []).find(e => e && e.path && !e.missing)
      return alive ? alive.path : ''
    })()`)
    if (recentPath) xlsx = { path: recentPath, name: recentPath.split('/').pop() }
  }
  if (!xlsx) return record('xlsx-open', false, `${root} 无可用的未打开 xlsx——先用应用手动保存任一 xlsx(且不打开它)后重跑`)
  const tab = await freshOpen(home, 'sheets', xlsx.path)
  if (!tab) return record('xlsx-open', false, `重开无新 sheets tab:${xlsx.name}`)
  // 激活该 tab(selection 依赖前台 activeWorkbook),等流式加载完成后取 selection
  await evalIn(home, `(async () => {
    const tabs = await window.aiOfficeTabs.list()
    const t = tabs.find(x => x.filePath === ${JSON.stringify(xlsx.path)})
    if (t) await window.aiOfficeTabs.activate(t.id)
    return 'ok'
  })()`)
  const c = await attach(tab)
  // 断言工作簿加载完成文案(sidecar 数据真实到达的证据),不依赖前台 focus:
  // 完成信号 =「行可用」/「工作簿已完整加载」/「就绪」;全程跟踪流式加载是否收敛
  let body = ''; let loaded = false
  for (let i = 0; i < 45; i++) {
    await sleep(1000)
    body = String(await evalIn(c, `document.body.innerText.replace(/\\s+/g,' ')`))
    if (/行可用|工作簿已完整加载|就绪——/.test(body)) { loaded = true; break }
  }
  const streaming = body.includes('正在流式加载')
  const fileNameShown = body.includes(xlsx.name.replace('.xlsx', ''))
  const clean = await pageClean(c)
  c.close()
  record('xlsx-open', clean.clean && loaded, `${xlsx.name} 加载完成=${loaded} 文件名出现=${fileNameShown} 仍卡流式=${streaming};干净=${clean.clean}`)
}

// ---------- md / html:静默保存 → 关 tab → 磁盘重开 ----------
async function silentSaveAndReopen(home, scheme, apiName, suggested, text) {
  const before = (await targets()).filter(t => t.url.startsWith(`genoffice-app://${scheme}`)).length
  await evalIn(home, `window.aiOffice.${scheme === 'markdown' ? 'newMarkdown' : 'newHtml'}()`)
  const t0 = Date.now()
  let tab = null
  while (Date.now() - t0 < 20000 && !tab) {
    tab = (await targets()).filter(t => t.url.startsWith(`genoffice-app://${scheme}`) && !t.url.includes('mode=tab'))[tab ? 0 : 0] || null
    const cur = (await targets()).filter(t => t.url.startsWith(`genoffice-app://${scheme}`))
    if (cur.length > before) { tab = cur[cur.length - 1]; break }
    tab = null
    await sleep(700)
  }
  if (!tab) return record(`${scheme}-save`, false, `新建后无 ${scheme} tab`)
  const c = await attach(tab)
  await sleep(1500)
  const saved = await evalIn(c, `(async () => {
    try {
      const r = await window.${apiName}.save({ text: ${JSON.stringify(text)}, imageSources: [], mode: 'save', suggestedName: ${JSON.stringify(suggested)} })
      return JSON.stringify(r)
    } catch (e) { return 'throw:' + e.message }
  })()`)
  c.close()
  let path = null
  try { const r = JSON.parse(saved); path = r?.path || r?.result?.path || null } catch {}
  if (!path) return record(`${scheme}-save`, false, `save 回复:${String(saved).slice(0, 80)}`)
  const reopened = await freshOpen(home, scheme, path)
  if (!reopened) return record(`${scheme}-save`, false, `落盘成功但磁盘重开失败:${path}`)
  const c2 = await attach(reopened)
  await sleep(1500)
  const clean = await pageClean(c2)
  // 源码在 CodeMirror 里,innerText 会被 token span 分行;needle 取无空白片段;textContent 兜底
  const needle = text.replace(/\s+/g, '').slice(4, 16)
  let hasText = false
  for (let i = 0; i < 15; i++) {
    hasText = !!(await evalIn(c2, `((document.querySelector('.cm-content')?.textContent ?? '') + document.body.innerText).replace(/\\s+/g,'').includes(${JSON.stringify(needle)})`))
    if (hasText) break
    await sleep(1000)
  }
  c2.close()
  record(`${scheme}-save`, clean.clean && hasText, `${path} 磁盘重开内容命中=${hasText} 干净=${clean.clean}`)
}

// ---------- pdf:落盘 + 自动打开 ----------
async function t_pdf(home) {
  const before = new Set((await targets()).map(t => t.webSocketDebuggerUrl))
  await evalIn(home, `window.aiOffice.newPdf()`)
  const t0 = Date.now()
  let tab = null
  while (Date.now() - t0 < 20000 && !tab) {
    tab = (await targets()).find(t => t.url.startsWith('genoffice-app://pdf') && !before.has(t.webSocketDebuggerUrl)) || null
    if (!tab) await sleep(700)
  }
  if (!tab) return record('pdf-open', false, 'newPdf 后无 pdf tab')
  const c = await attach(tab)
  let pages = null
  for (let i = 0; i < 15; i++) {
    await sleep(1000)
    pages = await evalIn(c, `(() => { const m = document.body.innerText.match(/(\\d+)\\s*\\/\\s*\\d+/); return m ? m[0] : (document.querySelectorAll('canvas').length || null) })()`)
    if (pages) break
  }
  const clean = await pageClean(c)
  c.close()
  record('pdf-open', !!pages && clean.clean, `页指示=${pages} 干净=${clean.clean}`)
}

const home = await homeConn()
await cleanupTabs(home)
await t_xlsx(home)
await silentSaveAndReopen(home, 'markdown', 'markdownApi', '回归-md', '# 六类型回归 sota office 设备级验证。')
await silentSaveAndReopen(home, 'html', 'htmlApi', '回归-html', '<h1>六类型回归</h1><p>sota office 设备级验证。</p>')
await t_pdf(home)
console.log(JSON.stringify({ port: process.argv[2], total: results.length, pass: results.filter(r => r.ok).length, results }, null, 1))
process.exit(results.some(r => !r.ok) ? 1 : 0)
