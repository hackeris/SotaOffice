// Sota Office 图标生成器——单一事实源,一键重生成全套图标资产
//
// 用法:   node docs/media/gen-sota-icon.mjs          (仓库根执行;脚本内部自行定位)
// 产出:   AppScope/resources/base/media/{background,foreground}.png  鸿蒙分层图标 1024 RGBA
//         entry/src/main/resources/base/media/app_icon.png           1024 RGBA(白底合成)
//         thirdparty/genoffice/apps/shell/build/icon.png             1024 RGBA
//         thirdparty/genoffice/apps/shell/build/icons/{16,32,48,64,128,256,512,1024}.png
//         docs/media/sota-icon.svg                                   矢量源(几何与光栅一致)
//
// 构图:沿用 GenOffice「两枚圆角方形斜向错位、交集区异色」的框架——
//   左上 = PPT 橙红,右下 = XLSX 绿,交集 = DOCX 蓝(继承双方圆角曲线),
//   交集上两枚白椭圆 = 「AI 之眼」。色值取自应用内首页 W/X/P 文件图标
//   (#D33922/#4FA16B/#3276CD),统一降饱和 20%、提浅 8%。
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const MASTER = 1024 // 主画布;其余尺寸按比例缩放几何

// ── 色彩:产品内色 → 降饱和 ×0.8 → 提浅 8% ──
const SAT = 0.8, LIGHTEN = 0.08
function desat([r, g, b]) {
  const mx = Math.max(r, g, b) / 255, mn = Math.min(r, g, b) / 255
  const l = (mx + mn) / 2
  let s = mx === mn ? 0 : (mx - mn) / (1 - Math.abs(2 * l - 1))
  const h = mx === mn ? 0
    : mx === r / 255 ? 60 * (((g - b) / 255 / s) % 6)
    : mx === g / 255 ? 60 * ((b - r) / 255 / s + 2)
    : 60 * ((r - g) / 255 / s + 4)
  s = Math.min(s * SAT, 1)
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  const t = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(h / 60) % 6]
  return [Math.round((t[0] + m) * 255), Math.round((t[1] + m) * 255), Math.round((t[2] + m) * 255)]
}
const lighten = ([r, g, b], f = LIGHTEN) => [r, g, b].map(v => Math.round(v + (255 - v) * f))
const hex = ([r, g, b]) => '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')

const ORANGE = lighten(desat([211, 57, 34]))  // #D33922 → 橙红
const GREEN  = lighten(desat([79, 161, 107])) // #4FA16B → 绿
const BLUE   = lighten(desat([50, 118, 205])) // #3276CD → 蓝
const WHITE  = [255, 255, 255]
console.log('色值:', hex(ORANGE), hex(GREEN), hex(BLUE))

// ── 几何(1024 基准) ──
const BASE = {
  A: { x: 212, y: 216, w: 408, h: 408, r: 96 }, // 左上 · 橙红
  B: { x: 332, y: 304, w: 408, h: 408, r: 96 }, // 右下 · 绿(交集 288×320)
}
// 自动居中:标记包围盒中心对齐画布中心——调参后不再手工配平
{
  const x0 = Math.min(BASE.A.x, BASE.B.x), x1 = Math.max(BASE.A.x + BASE.A.w, BASE.B.x + BASE.B.w)
  const y0 = Math.min(BASE.A.y, BASE.B.y), y1 = Math.max(BASE.A.y + BASE.A.h, BASE.B.y + BASE.B.h)
  const dx = Math.round(512 - (x0 + x1) / 2), dy = Math.round(512 - (y0 + y1) / 2)
  BASE.A.x += dx; BASE.B.x += dx
  BASE.A.y += dy; BASE.B.y += dy
}
// 「AI 之眼」:从蓝色交集区自动推导——水平居中,垂直位于中心上方 12% 处
const blueX0 = Math.max(BASE.A.x, BASE.B.x), blueX1 = Math.min(BASE.A.x + BASE.A.w, BASE.B.x + BASE.B.w)
const blueY0 = Math.max(BASE.A.y, BASE.B.y), blueY1 = Math.min(BASE.A.y + BASE.A.h, BASE.B.y + BASE.B.h)
const EYE_GAP = 84, EYE_RX = 19, EYE_RY = 25, EYE_RISE = 0.12 // 中心距 / 尺寸 / 上移比例
const BASE_EYES = [
  { cx: Math.round((blueX0 + blueX1) / 2 - EYE_GAP / 2),
    cy: Math.round((blueY0 + blueY1) / 2 - (blueY1 - blueY0) * EYE_RISE),
    rx: EYE_RX, ry: EYE_RY },
  { cx: Math.round((blueX0 + blueX1) / 2 + EYE_GAP / 2),
    cy: Math.round((blueY0 + blueY1) / 2 - (blueY1 - blueY0) * EYE_RISE),
    rx: EYE_RX, ry: EYE_RY },
]
// SCALE:标记整体缩放,绕画布中心。1.0 时标记仅占画布 ~57%;1.28 时 ~71%,
// 角落距画布中心 ~493,仍在系统圆形掩膜安全圈(半径 512)内;再大会裁边。
const SCALE = 1.36
const scaleGeo = ({ x, y, w, h, r }) => ({
  x: Math.round(512 + (x - 512) * SCALE),
  y: Math.round(512 + (y - 512) * SCALE),
  w: Math.round(w * SCALE), h: Math.round(h * SCALE), r: Math.round(r * SCALE),
})
const A = scaleGeo(BASE.A)
const B = scaleGeo(BASE.B)
const EYES = BASE_EYES.map(e => ({
  cx: Math.round(512 + (e.cx - 512) * SCALE),
  cy: Math.round(512 + (e.cy - 512) * SCALE),
  rx: Math.round(e.rx * SCALE), ry: Math.round(e.ry * SCALE),
}))

function insideRect(px, py, { x, y, w, h, r }, k) {
  const X = x * k, Y = y * k, W = w * k, H = h * k, R = r * k
  if (px < X || px > X + W || py < Y || py > Y + H) return false
  const cx = px < X + R ? X + R : px > X + W - R ? X + W - R : px
  const cy = py < Y + R ? Y + R : py > Y + H - R ? Y + H - R : py
  return (px - cx) ** 2 + (py - cy) ** 2 <= R * R
}
function insideEye(px, py, k) {
  return EYES.some(({ cx, cy, rx, ry }) => {
    const dx = (px - cx * k) / (rx * k), dy = (py - cy * k) / (ry * k)
    return dx * dx + dy * dy <= 1
  })
}

/** RGBA 光栅化。mode: 'mark'(透明底前景) | 'composite'(白底合成) */
function render(size, mode) {
  const k = size / MASTER
  const ss = Math.max(2, Math.min(64, Math.round(1536 / size))) // 自适应超采样
  const raw = Buffer.alloc(size * (1 + size * 4))
  let off = 0
  for (let y = 0; y < size; y++) {
    raw[off++] = 0 // filter: none
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const px = x + (sx + 0.5) / ss, py = y + (sy + 0.5) / ss
          const ia = insideRect(px, py, A, k), ib = insideRect(px, py, B, k)
          let c = null
          if (ia && ib) c = insideEye(px, py, k) ? WHITE : BLUE
          else if (ia) c = ORANGE
          else if (ib) c = GREEN
          if (c) { r += c[0]; g += c[1]; b += c[2]; a += 255 }
          else if (mode === 'composite') { r += 255; g += 255; b += 255; a += 255 }
        }
      }
      const n = ss * ss
      raw[off++] = Math.round(r / n); raw[off++] = Math.round(g / n)
      raw[off++] = Math.round(b / n); raw[off++] = Math.round(a / n)
    }
  }
  return encodePng(size, size, raw)
}

// ── PNG 编码(RGBA8) ──
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
function encodePng(w, h, raw) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8; ihdr[9] = 6 // 8bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ── 产出 ──
const OUT = [
  ['AppScope/resources/base/media/background.png', () => {
    const ihdr = Buffer.alloc(13)
    ihdr.writeUInt32BE(MASTER, 0); ihdr.writeUInt32BE(MASTER, 4)
    ihdr[8] = 8; ihdr[9] = 6
    const px = Buffer.alloc(MASTER * (1 + MASTER * 4), 255) // 纯白不透明
    return encodeRaw(ihdr, px)
  }],
  ['AppScope/resources/base/media/foreground.png', () => render(MASTER, 'mark')],
  ['entry/src/main/resources/base/media/app_icon.png', () => render(MASTER, 'composite')],
  ['thirdparty/genoffice/apps/shell/build/icon.png', () => render(MASTER, 'composite')],
  ...[16, 32, 48, 64, 128, 256, 512, 1024].map(s =>
    [`thirdparty/genoffice/apps/shell/build/icons/${s}x${s}.png`, () => render(s, 'composite')]),
]
function encodeRaw(ihdr, raw) {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

for (const [rel, make] of OUT) {
  const p = join(ROOT, rel)
  const png = make()
  // 验收断言:PNG 签名 + IHDR 尺寸
  if (png.readUInt32BE(0) !== 0x89504e47) throw new Error(`FATAL: ${rel} PNG 签名错误`)
  if (png.readUInt32BE(16) !== Number(rel.match(/(\d+)x\d+\.png$/)?.[1] ?? MASTER)) {
    throw new Error(`FATAL: ${rel} 尺寸不符`)
  }
  writeFileSync(p, png)
  console.log('written', rel, png.length, 'bytes')
}

// 矢量源(几何/色值与光栅一致)
const svg = `<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <rect width="1024" height="1024" fill="#FFFFFF"/>
  <defs>
    <clipPath id="a">
      <rect x="${A.x}" y="${A.y}" width="${A.w}" height="${A.h}" rx="${A.r}"/>
    </clipPath>
  </defs>
  <rect x="${A.x}" y="${A.y}" width="${A.w}" height="${A.h}" rx="${A.r}" fill="${hex(ORANGE)}"/>
  <rect x="${B.x}" y="${B.y}" width="${B.w}" height="${B.h}" rx="${B.r}" fill="${hex(GREEN)}"/>
  <g clip-path="url(#a)">
    <rect x="${B.x}" y="${B.y}" width="${B.w}" height="${B.h}" rx="${B.r}" fill="${hex(BLUE)}"/>
  </g>
  <ellipse cx="${EYES[0].cx}" cy="${EYES[0].cy}" rx="${EYES[0].rx}" ry="${EYES[0].ry}" fill="#FFFFFF"/>
  <ellipse cx="${EYES[1].cx}" cy="${EYES[1].cy}" rx="${EYES[1].rx}" ry="${EYES[1].ry}" fill="#FFFFFF"/>
</svg>
`
writeFileSync(join(dirname(fileURLToPath(import.meta.url)), 'sota-icon.svg'), svg)
console.log('written docs/media/sota-icon.svg')
console.log('== 图标资产生成完成 ==')
