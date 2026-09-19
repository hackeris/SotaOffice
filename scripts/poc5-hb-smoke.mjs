// POC-5b:harfbuzz.wasm(shaping)+ hb-subset.wasm(子集化)在 Node 22 的 host 预验
// 用法:cd genoffice-e37/apps/pdf && node ../../../genoffice-ohos/scripts/poc5-hb-smoke.mjs
// 调用链照抄 genoffice 真实用法(shaped-metrics.ts 裸 wasmExports / font-subset.ts)
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

// harfbuzzjs 的 exports map 不暴露内部路径(与 genoffice 的 deep-import 同款绕法)
const HBJS = resolve(process.cwd(), '../../node_modules/harfbuzzjs/dist/harfbuzz.js')
const HBWASM = resolve(process.cwd(), '../../node_modules/harfbuzzjs/dist/harfbuzz.wasm')
const HBSUBSET = resolve(process.cwd(), '../../node_modules/harfbuzzjs/dist/harfbuzz-subset.wasm')
const CARLITO = resolve(process.cwd(), '../../packages/ui/src/fonts/Carlito-Regular.ttf')

const fontData = readFileSync(CARLITO)
console.log('字体: Carlito-Regular.ttf', fontData.length, 'bytes')

// ---------- 1) harfbuzz shaping(shaped-metrics.ts 同款裸调用)----------
{
  const factory = (await import('file://' + HBJS)).default
  const mod = await factory({ wasmBinary: readFileSync(HBWASM) })
  const ex = mod.wasmExports
  const put = (bytes) => { const p = ex.malloc(bytes.length); mod.HEAPU8.set(bytes, p); return p }
  const fontPtr0 = put(fontData)
  const blob = ex.hb_blob_create(fontPtr0, fontData.length, 2 /*WRITABLE*/, 0, 0)
  const face = ex.hb_face_create(blob, 0)
  const upem = ex.hb_face_get_upem(face)
  const font = ex.hb_font_create(face)
  ex.hb_font_set_scale(font, 1000, 1000)
  console.log('✓ face 创建,upem =', upem)

  const shape = (text) => {
    const buf = ex.hb_buffer_create()
    const strPtr = ex.malloc(text.length * 2)
    for (let i = 0; i < text.length; i++) mod.HEAPU16[strPtr / 2 + i] = text.charCodeAt(i)
    ex.hb_buffer_add_utf16(buf, strPtr, text.length, 0, text.length)
    ex.hb_buffer_guess_segment_properties(buf)
    ex.hb_shape(font, buf, 0, 0)
    const n = ex.hb_buffer_get_length(buf)
    const infos = ex.hb_buffer_get_glyph_infos(buf, 0)
    const poss = ex.hb_buffer_get_glyph_positions(buf, 0)
    const out = []
    for (let i = 0; i < n; i++) {
      const codepoint = mod.HEAPU32[infos / 4 + (i * 20) / 4] // hb_glyph_info_t = 20B
      const xAdvance = mod.HEAP32[poss / 4 + (i * 24) / 4] // hb_glyph_position_t = 24B
      out.push([codepoint, xAdvance])
    }
    ex.hb_buffer_destroy(buf)
    return out
  }
  for (const [name, text] of Object.entries({ latin: 'Hello', arabic: 'مرحبا', devanagari: 'नमस्ते' })) {
    const glyphs = shape(text)
    if (!glyphs.length) throw new Error(`${name} shaping 结果为空`)
    const notdef = glyphs.filter(([cp]) => cp === 0).length
    if (notdef === glyphs.length && name === 'latin') throw new Error(`latin shaping 全 .notdef(引擎异常)`)
    if (notdef === glyphs.length) {
      // Carlito 无该文字字形:.notdef = genoffice coverage-check 的设计语义(真机上此脚本走系统字体)
      console.log(`✓ shaping ${name}: ${glyphs.length} glyphs 全 .notdef(coverage 语义正确,Carlito 无 ${name} 字形,真机走系统字体)`)
    } else {
      console.log(`✓ shaping ${name}: ${glyphs.length} glyphs, (codepoint,x_advance)=`, JSON.stringify(glyphs.slice(0, 4)))
    }
  }
  console.log('✓ harfbuzz.wasm shaping 引擎验证通过(latin 实测 + coverage 语义实测)\n')
}

// ---------- 2) hb-subset 子集化(font-subset.ts 同款调用链)----------
{
  const { instance } = await WebAssembly.instantiate(readFileSync(HBSUBSET))
  const w = instance.exports
  const put = (bytes) => { const p = w.malloc(bytes.length); new Uint8Array(w.memory.buffer).set(bytes, p); return p }
  const fontPtr = put(fontData)
  const blob = w.hb_blob_create(fontPtr, fontData.length, 2, 0, 0)
  const face = w.hb_face_create(blob, 0)
  const input = w.hb_subset_input_create_or_fail()
  for (const ch of ['H', 'i', '!']) w.hb_set_add(w.hb_subset_input_unicode_set(input), ch.codePointAt(0))
  w.hb_set_invert(w.hb_subset_input_unicode_set(input))
  const keepLayout = w.hb_subset_input_set(input, 6 /*LAYOUT_FEATURE_TAG*/)
  if (keepLayout) w.hb_set_invert(keepLayout)
  const subsetFace = w.hb_subset_or_fail(face, input)
  if (!subsetFace) throw new Error('hb_subset_or_fail 返回空')
  const outBlob = w.hb_face_reference_blob(subsetFace)
  const outLen = w.hb_blob_get_length(outBlob)
  const dataPtr = w.hb_blob_get_data(outBlob, 0)
  const subset = Buffer.from(new Uint8Array(w.memory.buffer).subarray(dataPtr, dataPtr + outLen))
  writeFileSync('/tmp/poc5-carlito-subset.ttf', subset)
  const tag = subset.subarray(0, 4).toString('latin1')
  console.log(`✓ hb-subset 子集化: ${fontData.length} → ${subset.length} bytes(sfnt tag=${JSON.stringify(tag)})`)
  if (subset.length >= fontData.length || !['\x00\x01\x00\x00', 'true', 'OTTO'].includes(tag))
    throw new Error('子集产物异常')
}

console.log('\nPOC-5b 结论:harfbuzz.wasm + hb-subset.wasm 在 Node 22 主进程环境可用')
