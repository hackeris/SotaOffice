# 附录 A:GenOffice 架构与平台耦合点分析

> 来源:2026-09-19 源码级逐包审查(渲染层/main/preload/packages 全量)。路径以 `.temp/genoffice` 为根。

## 0. 总体规模

| 维度 | 数据 |
|---|---|
| 代码总量(不含测试) | ≈ 55 万行 TS/TSX(渲染层 354,918 + main/preload 53,622 + packages/src 142,772) |
| Electron 版本 | 43.3.0,engines 要求 Node ≥22.12 |
| 主进程 IPC handler | **419 个** `ipcMain.handle` |
| 原生(napi/.node)模块 | **0 个** |
| 真正的二进制依赖 | 1 个 Rust 子进程 + 3 个 wasm + 2 个平台 OCR helper |

关键结论:**渲染层 100% 纯 Web(renderer 目录 `from 'electron'` 零命中),主进程被抽象为 7 组 `window.*` 桥接 API;引擎包刻意 "Electron-free"**。移植主战场是宿主层(shell + 各 app main/preload,约 5.4 万行 + 419 IPC)而非编辑器本体。

## 1. Workspace 全景

apps/*(7 个)。所有 app 的 `src/main` 编译进 shell 构建(CLAUDE.md 记载,shell 相对路径 import 各 app main):

| 包 | 职责 | 渲染技术 | main 规模 |
|---|---|---|---|
| @genoffice/docs | AI docx 编辑器,paragraph-patch 保存 | TipTap(ProseMirror)+ DOM 分页 | docs-main.ts 201KB |
| @genoffice/sheets | AI 电子表格 | Univer 0.25(canvas,engine-render) | sheets-main.ts 188KB |
| @genoffice/slides | AI pptx 编辑器,字节保真 | Konva/react-konva + pptx-render RenderTree | slides-main.ts 184KB |
| @genoffice/pdf | PDF 查看/编辑/签名/OCR | PDF.js canvas + TextLayer DOM | pdf-main 60KB + text-edit 105KB + save-pdf 39KB |
| @genoffice/markdown | .md 块编辑器 | TipTap + mermaid/katex/wavedrom | 43KB |
| @genoffice/html | HTML 源码+实时预览 | CodeMirror 6 + iframe | 75KB |
| @genoffice/shell | 统一宿主:启动页/标签/MCP/updater | React(Home.tsx 105KB) | index.ts 218KB(5033 行) |

packages/*(18 个)按运行环境分类:

**A. 纯逻辑(任何 JS 环境)**:i18n(198 行)、agent-core(1,312,ReAct 循环零依赖)、pptx-engine(23,898)、pptx-ops(4,929,"Electron-free")、xlsx-gateway(21,180,"no Electron, no Univer")、docx-engine(28,381)、pptx-render(9,618,RenderTree 纯数据)、pipelines(1,415)、ai-provider(4,858,fetch,含 browser 入口)、file-parse(700)、html2docx(3,914,browser/core 在浏览器跑)。

**B. 纯逻辑但依赖 node:fs**:project-store(968,路径由调用方注入)、cli(15,601,esbuild cjs + jsdom + MCP SDK)、pdf2docx(19,919,引擎/OCR 调用方注入)、font-metrics(827,平台字体目录表 + 定向读 sfnt)。

**C. 依赖 Electron/Node 宿主**:electron-utils(2,292,renderer-protocol 实现 `genoffice-app://`)、ui(1,043 + Carlito 字体)、ai-search(1,719,fetch + gsk CLI 子进程)。

## 2. Electron 主进程边界

- 单 BrowserWindow + WebContentsView 标签模型(TabManager);Home 由 shell webContents 渲染;spare sheets view 预热(tab-manager.ts:105-133)。
- 窗口:`sandbox:true, contextIsolation:true, nodeIntegration:false`;macOS `titleBarStyle:hiddenInset + vibrancy`,Win/Linux `hidden + titleBarOverlay`——标签栏即标题栏,深度定制 chrome。

Node 专有 API(main 目录 import 计数):node:path×46、node:fs×42(+fs/promises×24)、node:crypto×22、node:os×10、node:url×5、child_process(5 处:sheets Rust sidecar / MCP spawn CLI / gsk+codex CLI / OCR helper / shell 杂项)、node:net×3(control-server,unix socket/named pipe)、node:http×2(MCP Streamable HTTP+SSE,端口 3093)、node:zlib×2、worker_threads×1(slides 字体扫描)、readline/module×1。

Electron API 面:`webContents.*`×134、`dialog.showMessageBox`×59、`app.getPath`×51、`new BrowserWindow`×25、`Menu.buildFromTemplate`×10、`shell.*`×34、`new WebContentsView`×7、nativeTheme×7、`protocol.handle`×4、clipboard×8、screen×6、printToPDF 多处、`requestSingleInstanceLock`×4。

IPC(preload 暴露 7 组 + 消费计数):`window.slidesApi`×264、`desktop`×101、`aiOffice`×91、`desktopApi`×85、`pdfApi`×65、`htmlApi`×60、`markdownApi`×45、`projectApi`×19、`aiOfficeTabs`×12。通道分类:窗口/标签 20+、文件对话框与读写 ~60、打印/PDF ~25、剪贴板 8、AI 15、字体 ~10、slides 编辑 **120+**、sheets 工作簿 50、pdf 编辑 18、home/shell ~60。自定义 scheme:`genoffice-app://`(六模块静态资源+codeCache)、`genoffice-docx-media://`、`md-asset://`、`html-asset://` + html 预览 scheme。**无统一 transport 抽象**(各 app 手写 `src/shared/ipc.ts`;唯一近似:agent-core 的 IpcTransport)。

## 3. 渲染层(纯 Web 验证)

- docs:TipTap/ProseMirror contenteditable;分页 = DOM 测量驱动纯函数页切;打印走 renderer 生成 print HTML → 主进程 printToPDF。
- sheets:本地替换 @univerjs/presets(规避 27 个商业包)+ engine-render canvas;打印同上(隐藏窗口 printToPDF)。
- slides:konva-adapter 自述"thin adapter on RenderTree (pure data)";文本编辑 DOM overlay。
- pdf:pdfjs-dist TextLayer + canvas;搜索/注释/表单 DOM。
- markdown:TipTap + mermaid/katex/wavedrom(lazy)。
- html:CodeMirror 6 + iframe 实时预览(特意不用 srcdoc)。
- 无 WebGL 直用;标准 Web API。**六个 renderer + shell Home 可在任何 Chromium 内核加载,产物为纯静态资源。**

## 4. 原生 / Rust 依赖

1. **Rust xlsx sidecar**:`apps/sheets/native/xlsx-engine/`(crate xlsx-sidecar,edition 2024;calamine 读/ironcalc 公式/quick-xml/roxmltree/zip 纯 Rust)。**stdio JSON-lines 子进程**(非 napi 非 wasm),UUID 请求-应答,30s/180s 超时。Windows crt-static、mac lipo universal。
2. **PDFium wasm**(@embedpdf/pdfium):主进程懒加载,路径 `apps/pdf/src/main/wasm-path.ts`;pdf2docx / pdf2pptx-local / pdf2xlsx-local 共享单例。**跑在 Node 主进程**。
3. **HarfBuzz wasm ×2**:hb-subset(PDF 字体子集化)、harfbuzz(复杂脚本 shaping)。
4. **OCR helper(需替换)**:vision-ocr.swift / win-ocr.cs,PNG→stdin/JSON→stdout 协议;引擎是注入抽象,Linux 无引擎时优雅降级为位图(移植友好)。
5. 其他二进制:Carlito TTF×4、docs 内嵌字体 ~12MB(Liberation/Caladea + Noto CJK/Arabic woff2 子集)、字体 CDN 目录(sha256)、@genspark/cli 与 genoffice CLI(ELECTRON_RUN_AS_NODE)。

## 5. AI / 网络层

ai-provider:标准 fetch;唯一 Electron 网络耦合是可选注入的 rescueFetch(electron net.fetch 重试通道)。19 provider + custom。codex-app-server(976 行)spawn codex CLI(强依赖本地进程,建议裁剪)。agent-core 纯 ReAct 循环,流式分块经 IPC。ai-search:fetch 直连 Serper/Tavily/DDG + gsk CLI。主进程做 AI 网络以规避 renderer CORS。

## 6. 文件系统与 OS 集成

project-store(JSONL+原子写)、folder-tree(递归 fs.watch + trash/reveal)、recent-files、open-documents(单实例路由)、markdown/html 资产生命周期(**POSIX 同目录写**,与沙箱模型冲突)、临时文件、系统对话框×69、printToPDF、clipboard、文件关联×11、electron-updater(35KB 状态机)、MCP server(node:http)、control socket(node:net)、拖放(webUtils)、Zotero、spellcheck、崩溃诊断。无 Tray/Notification。

## 7. 字体与文本测量

font-metrics:平台字体目录表 + 定向读 sfnt。slides main 字体栈(57KB):启动扫文件名建索引(worker_threads)、懒解析 opentype.js、TTC 拆面、harfbuzz wasm shaping(**按 OS 硬编码 FONT_TABLE**)、Carlito 做 Calibri 度量替身、CDN/用户字体。关键耦合:**度量在主进程读真实字体文件,绘制走 Chromium 按家族名解析**——三角关系需在 OHOS 重新校准(FONT_TABLE 出 OH 版)。

## 8. 构建体系

electron-vite 三段式;preload 必须单文件 bundle;renderer = vite + react。**renderer 产物纯静态资源**,生产由 `genoffice-app://<module>/index.html` 映射磁盘目录。electron-builder:extraResources(六模块 out + wasm + ocr + gsk + cli)、11 文件关联、npmRebuild:false。CLI:esbuild 单文件 cjs + jsdom 树。e2e:Playwright electron.launch(**鸿蒙不可用,51 spec 需重建**)。

## 9. 四档分类结论

- **档 1 直接复用**:全部引擎包 + 六个 renderer(35.5 万行)+ packages/ui + 引擎包 vitest 单测。
- **档 2 需适配层**:IPC 桥(最大单项)、AI 网络代理、project-store/recent/settings(fs 适配)、folder-tree/watch、`genoffice-app://` 装载、html2docx driver、打印/PDF 导出、拖放/对话框/剪贴板/主题、CLI/MCP 选址。——**路线 A 下大部分原样跑,适配集中在 OS 语义差异**。
- **档 3 重写/替换**:shell 宿主窗口 chrome 类(A 路线下缩窄为:updater→打桩、单实例→Want、OCR→Vision Kit/降级、FONT_TABLE OH 版、codex/gsk 裁剪)。
- **档 4 交叉编译**:xlsx-sidecar(ohos target 可行性高);wasm 无需编译但运行位置需验证(fork Node 主进程预期可用)。

## 10. 风险权重

1. IPC 面绝对规模(419 handler;A 路线转化为"fork 上逐通道验证");2. 文件系统模型冲突;3. Chromium 宿主假设(printToPDF/CDP/capturePage/spellcheck);4. pdfium wasm 宿主位置;5. 字体三角;6. Rust sidecar 交叉编译(中低);7. 测试网重建。
