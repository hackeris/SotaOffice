// selfcheck-cdp.mjs —— 真机自检远程执行器(9333 CDP 通道)
//
// 正确命令:node scripts/selfcheck-cdp.mjs [wsUrl]
// 正确目录:仓根(ws 依赖从本仓根 package.json 解析)
// 前提:    真机已装自检 HAP 并启动;hdc fport tcp:9333 tcp:9333 已建立
// 用法:    连 genoffice-app://selfcheck 页面,逐项调用 window.selfcheck.run() 输出 JSON
// 姊妹工具:Page.captureScreenshot 截图(同 ws 会话)
import { createRequire } from 'node:module'

const req = createRequire(new URL('../package.json', import.meta.url))
const WebSocket = req('ws')

const WS = process.argv[2] || (await (await fetch('http://127.0.0.1:9333/json/list')).json())[0].webSocketDebuggerUrl
const ws = new WebSocket(WS, { perMessageDeflate: false })
let seq = 0
const pending = new Map()
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++seq
  pending.set(id, { res, rej })
  ws.send(JSON.stringify({ id, method, params }))
})
ws.on('message', (d) => {
  const m = JSON.parse(d)
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result) }
})
ws.on('open', async () => {
  try {
    await send('Runtime.enable')
    const expr = `(async () => {
      const ids = ['probe','env','clipboard','printToPDF','wco','sidecar','wasm','tray','native-image'];
      const out = {};
      for (const id of ids) {
        try { out[id] = await window.selfcheck.run(id); }
        catch (e) { out[id] = { ok: false, detail: 'threw: ' + (e?.message || e) }; }
      }
      return out;
    })()`
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
    console.log(JSON.stringify(r.result.value, null, 1))
    process.exit(0)
  } catch (e) { console.error('CDP error:', e.message); process.exit(1) }
})
ws.on('error', (e) => { console.error('ws error:', e.message); process.exit(1) })
