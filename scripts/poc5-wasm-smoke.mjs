// POC-5a:pdfium.wasm 在 Node 22 的 host 预验(与 fork 主进程同为 V8,行为跨架构一致)
// 用法:cd /data/share/smartoffice/.temp/genoffice-e37/apps/pdf && node /data/share/genoffice-ohos/scripts/poc5-wasm-smoke.mjs
// 验证:init → _PDFiumExt_Init → LoadMemDocument → GetPageCount → 文本提取 → SaveAsCopy
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

// 以 cwd(= genoffice-e37/apps/pdf)为解析基点,脚本自身目录不在 workspace 内
const req = createRequire(resolve(process.cwd(), 'package.json'))
const wasmPath = req.resolve('@embedpdf/pdfium/pdfium.wasm')
const raw = readFileSync(wasmPath)
const wasmBinary = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)

const { init } = req('@embedpdf/pdfium')
const wrapped = await init({ wasmBinary, thisProgram: 'poc5-smoke' })
const m = 'pdfium' in wrapped ? wrapped.pdfium : wrapped
m._PDFiumExt_Init()
console.log('✓ pdfium wasm init + PDFiumExt_Init')

// --- 最小合法 PDF(Helvetica 单行文本)---
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
writeFileSync('/tmp/poc5-minimal.pdf', pdf)
const data = readFileSync('/tmp/poc5-minimal.pdf')

// --- 打开 + 页数 ---
const docPtr = m._malloc(data.length)
m.HEAPU8.set(data, docPtr)
const doc = m._FPDF_LoadMemDocument(docPtr, data.length, 0)
if (!doc) { console.error('✗ LoadMemDocument failed, err=' + m._FPDF_GetLastError()); process.exit(1) }
console.log('✓ LoadMemDocument, pageCount =', m._FPDF_GetPageCount(doc))

// --- 文本提取 ---
const page = m._FPDF_LoadPage(doc, 0)
const tp = m._FPDFText_LoadPage(page)
const nChars = m._FPDFText_CountChars(tp)
const buf = m._malloc((nChars + 1) * 2)
const got = m._FPDFText_GetText(tp, 0, nChars, buf)
let text = ''
for (let i = 0; i < got - 1; i++) text += String.fromCharCode(m.HEAPU16[(buf >> 1) + i])
console.log('✓ 文本提取:', JSON.stringify(text))

// --- 保存副本(内存 writer,SaveAsCopy→GetFileWriterData)---
const writer = m._PDFiumExt_OpenFileWriter()
if (!m._PDFiumExt_SaveAsCopy(doc, writer)) { console.error('✗ SaveAsCopy failed'); process.exit(1) }
const size = m._PDFiumExt_GetFileWriterSize(writer)
const bufPtr = m._malloc(size)
m._PDFiumExt_GetFileWriterData(writer, bufPtr, size)
const saved = Buffer.from(m.HEAPU8.subarray(bufPtr, bufPtr + size))
writeFileSync('/tmp/poc5-copy.pdf', saved)
console.log('✓ SaveAsCopy:', saved.length, 'bytes, %PDF头=', saved.slice(0, 5).toString())

console.log('\nPOC-5a 结论:pdfium.wasm 在 Node 22 主进程环境全链可用(init/parse/text/save)')
