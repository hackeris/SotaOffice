# GenOffice 鸿蒙迁移问题分析(MIGRATION_ISSUES)

> 状态:2026-09-19 基于三份附录分析 + POC-2 结果(electron 43→37 静态断点=0)制定
> 定位:PORT_DESIGN 的展开层——**逐问题给出:现象/证据 → 解决办法 → 原理 → 置信度**
> 置信度:✅ 已验证 | 🟢 方案明确低风险 | 🟡 需 POC 验证 | 🔴 高风险需绕行/降级预案
>
> ⚠ **关于下面的状态标记(2026-09-24 补注)**:那些 ✅/🟢/🟡/🔴 是**制定时**的置信度评估,
> **不是当前状态**。本文写于真机验证之前,而 M1/M2 的实测已经覆盖了大部分条目,
> 其中若干判断被推翻——例如退出时的 dlclose 崩溃被证伪、IME 实测通过、
> `media(hover:none)` 只影响触屏的说法也不成立(真机上 hover 与 pointer 全空,PC 同样受影响)。
> **请把本文当分析框架看**,结论以 `M1_ACCEPTANCE.md`、`M2_VERIFY_CHECKLIST.md`
> 以及三份操作手册为准。

---

## 0. 验证深度声明(为什么"静态零断点"≠"迁移容易")

POC-2 只覆盖了**类型层与构建层**:证明 55 万行代码没有调用 38~43 新增的 Electron API。它**不能**证明:

1. 行为层:37→43 间"签名未变、默认值/时序变了"的变更(如 WebContentsView 后台节流策略、protocol handler 语义);
2. fork 层:openharmony fork 与上游 37 的差异(ozone-ohos 窗口层替换、被裁剪的模块、已知缺陷);
3. OS 层:Node API 在 OHOS musl/沙箱/appspawn 环境下的行为;
4. 产品层:文件模型、输入体验、窗口 chrome 的语义落差。

下文按层展开。**工作量重心预测:L2/L4/L5(运行时+窗口+文件)是 M1 的主战场,L6/L7(二进制+字体)是保真度的关键。**

---

## L1 启动与装载链

### 1.1 应用装载形态 🟢
- **问题**:GenOffice 是标准 Electron 应用(package.json main = out/main/index.js),fork 的装载链是 appspawn fork `electron` 启动器 → chdir(resfile) → ElectronMain → 按惯例找 app。
- **解法**:产物放 `resfile/resources/app/`,main 指向 `main-shim.mjs`(shim 最后 `await import('./out/main/index.js')`)。六模块 renderer 产物与 wasm/sidecar 按原 extraResources 布局的相对关系平移。
- **原理**:fork 的 ElectronMain 与上游一致地解析 app 目录;hos_vscodium 以此装载 284MB 的 VSCodium,实证可行(附录 C §2/§3)。

### 1.2 `process.platform` 分支 🟡
- **问题**:fork 报 `platform === 'openharmony'`。GenOffice 主进程按 `darwin|win32|linux` 三分支(字体目录表 `packages/font-metrics/src/sfnt.ts:19-33`、`shaped-metrics.ts` 的 FONT_TABLE、回收站 `explorer.exe`、mac 诊断 `/usr/bin/sample`)。ohos 值会掉进 else 分支或直接走错路径。
- **解法**:shim 把 `process.platform` mock 为 `'linux'`(hos_vscodium 六件事之一,其注释:不 mock 则 VSCode 按平台 switch 漏注册自杀——GenOffice 需先 grep 全部平台分支确认无同类**启动即崩**点),再对 mock 后被激活但 OHOS 上不成立的子系统做二级行为注入:
  - 字体目录:环境变量注入 OHOS 字体路径(见 L7),不改源码;
  - 回收站/reveal 等系统杂项:走 L5.4 降级。
- **原理**:OHOS 内核为 Linux、musl libc、POSIX 路径,linux 分支的**通用假设**(路径分隔符、shell 可用性除外)大体成立;mock 比加 ohos 分支改动面小一个量级。**残余风险**:linux 分支里 shell 脚本调用(`apps/slides/src/main/slides-main.ts:340` 等)在 OHOS 无 `/bin/sh` 时报错——hos_vscodium 打包了 ohos 版 bash 可复用,或裁剪。

### 1.3 主进程原生模块预加载 🟢(可能不适用)
- **问题**:fork 在窗口起来后销毁(创建主进程 JS VM 的)ArkTS VM,此后首次 dlopen .node 会 abort(hos_vscodium 六件事之 6)。
- **解法**:GenOffice **零 .node 模块**(附录 A §0),理论上不适用;但 shim 里保留预加载钩子,M1 若发现动态加载行为异常再启用。
- **原理**:该坑的触发条件是"懒加载 .node",GenOffice 无此路径;`worker_threads`(见 L3.5)是独立问题。

---

## L2 Electron API 运行时差异

### 2.1 37↔43 行为变更(签名不变、语义变) 🟡
- **问题**:类型层零断点只说明 API 都存在。Electron 38~43 间存在默认值/时序/语义变更,静态查不出。
- **解法**:POC-3 冒烟清单直接从 51 个 Playwright e2e spec 中抽取核心路径(启动、六模块各开一个真实文档、编辑、保存、多标签切换、导出 PDF),在真机逐条跑;**fork 支持 remote-debugging(9333 端口)→ Playwright 可 `chromium.connectOverCDP` 直连**,e2e 体系可基于 CDP 重建而非全灭(见 L10)。
- **原理**:行为差异只能运行时暴露;CDP 是 Chromium 的调试协议,fork 保留(附录 C 调试节),这使自动化回归有了抓手。

### 2.2 fork 已知缺陷三件套 🔴→🟡
| 缺陷 | 对 GenOffice 的预测影响 | 解法/原理 |
|---|---|---|
| IME 个别场景异常(依赖系统 IME 文本提交) | **核心风险**:Docs/Markdown 用 TipTap(contenteditable)、HTML 用 CodeMirror,全是 IME 重度用户 | POC-7 用真机物理键盘+中文输入法逐编辑器实测;若踩中,短期以英文/物理键盘为主可用,中期评估 fork 上游修复或自绘候选框(contenteditable 的 compositionstart/end 事件兜底)。**这是 M1 验收的必测项** |
| 退出时 dlclose 崩溃 | 退出瞬间崩溃,数据已落盘(GenOffice 原子写)则无损 | PREPARE_APP_TERMINATE 权限 + 守卫落盘完成后主动 `_exit()`;崩溃留痕用 crash-hook(附录 C 可直接搬)。原理:绕过 fork 的库卸载时序问题 |
| `media(hover: none)` 隐藏 UI | PC 有鼠标(hover:hover)不受影响;**触屏平板(M2)受影响** | renderer CSS 加 ohos 形态检测兜底;M2 触屏适配时统一处理 |

### 2.3 Chromium 宿主能力(printToPDF / capturePage / executeJavaScript / spellcheck) 🟡
- **问题**:GenOffice 的打印/导出全走 `webContents.printToPDF`(docs-main.ts:3960,4078、sheets/pdf-export.ts、slides/pdf-export.ts、markdown);html2docx 走 playwright driver(隐式 CDP);拼写走 Chromium spellcheck。fork 是否完整保留这些 headless 管线未证。
- **解法**:POC-7 逐项验证;备选链按优先级:①printToPDF 可用 → 直通;②不可用 → renderer 侧生成 PDF(前端已有 pdf-lib/jspdf 能力,docs 的打印 HTML 管线改造为交付中间格式)+ ArkTS 桥 `@ohos.print`(office 实证模板);③html2docx 补 ArkWeb driver 或预转换模式。
- **原理**:fork 是完整 Chromium 138 内核,仅窗口层(ozone)被替换;打印管线不依赖 ozone,大概率可用——但"大概率"必须实测。capturePage(缩略图)失败可降级为空白占位。

---

## L3 主进程 Node API 在 OHOS 的行为

### 3.1 fs/路径/cryo(os.homedir/tmpdir) 🟢
- **解法**:shim 注入 `HOME=/data/storage/el2/base/files`(不可写回退链参考 hos_vscodium)+ XDG_*;`app.getPath('userData')` 随之落在沙箱可写区。
- **原理**:fork 的 Electron 跑在应用沙箱,el2/base 是应用专属可写目录;hos_vscodium 同款注入实证。

### 3.2 node:http(MCP :3093)/ node:net(unix socket) 🟡
- **解法**:POC-3 验证沙箱内 localhost listen 与 UDS。预期可用(INTERNET 权限 + 本地回环不涉网);不可用则 MCP 降级为 stdio 模式(M3 再议)。
- **原理**:OHOS 沙箱允许应用自 listen 本地端口(办公套件无对外服务需求);hos_vscodium 的 Chromium DevTools 9333 端口 listen 就是实证。

### 3.3 child_process spawn(Rust sidecar、CLI) 🟢(机制)/🟡(细节)
- **解法**:xlsx-sidecar 静态编译后注册 `executableBinaryPaths`;spawn 路径解析自 `process.resourcesPath`,打包时把 sidecar 放到 fork 的资源根可达位置。
- **原理**:fork 的进程创建走 appspawn 协议,`executableBinaryPaths` 注册的二进制可被 spawn/继承应用身份(hos_vscodium 的 rg/bash 每次搜索都在 spawn,高频实证);注意**未注册路径**的动态二进制不可执行——GenOffice 的 OCR helper(swift/c#)属于此类,直接裁掉(走 Linux 降级路径)。

### 3.4 fs.watch(recursive) 🟡
- **问题**:folder-tree(`apps/shell/src/main/folder-tree.ts:354`)用 `fs.watch(root, {recursive:true})` 做 Home 页文件树。
- **解法**:POC-3 验证;不可用则降级为受控轮询(树+mtime,秒级间隔)或裁剪实时性(打开 Home 时刷新)。非关键路径,降级可接受。
- **原理**:Node 在 Linux 的 recursive watch 依赖内核 inotify 的递归注册,OHOS 内核(Linux 5.10/6.6)支持 inotify,但 musl/mount 视图差异可能影响 /storage 下大目录行为。

### 3.5 worker_threads 🟡
- **问题**:slides 字体扫描用 worker_threads(`apps/slides/src/main/font-scan.ts`);fork 的主进程线程模型未知。
- **解法**:POC-3 验证;不可用则改主线程同步扫描(启动期一次性任务,几十 ms 级,可接受)。
- **原理**:fork = 完整 Node 22,worker_threads 属核心能力;风险点仅在它与 ArkTS 宿主线程的交互——hos_vscodium 未使用 worker(无先例),故列验证而非默认可用。

---

## L4 窗口与 UI chrome

### 4.1 标签栏即标题栏(titleBarOverlay/vibrancy) 🟡
- **问题**:GenOffice 窗口 `titleBarStyle:hidden + titleBarOverlay`(Win/Linux)或 `hiddenInset + vibrancy`(mac),自绘标签栏集成窗口控件。fork 的 WCO 方法缺失(hos_vscodium 打桩了 setTitleBarOverlay 等)。
- **解法**:POC-7 验证 frameless BrowserWindow 在 fork/ozone-ohos 的行为:①支持 frameless → 自绘标签栏直接可用(推荐:三键区域 padding 避让,office 项目经验:系统三键仍在右上角);②不支持 → 接受系统标题栏,标签栏退化为窗口内容(样式降级,功能无损)。
- **原理**:ozone-ohos 是窗口系统集成层,frameless 属 ozone 平台能力范畴,fork 对 2in1 形态有 PC 窗口支持(hos_vscodium 的自绘标题栏 IPC 间接说明窗口控制可用)。

### 4.2 原生菜单(Menu ×10)与上下文菜单 🟡
- **解法**:POC-7 验证 fork 的 Menu/dialog 呈现;不可用则:全局菜单在 PC 上本就弱化(应用内工具栏为主),上下文菜单(context-menu.ts)降级为 Web 渲染的右键菜单(renderer 内已有类似组件)。
- **原理**:菜单入口按钮在 React 工具栏里,原生 Menu 仅是呈现层,替换呈现层不动业务。

### 4.3 多窗口(隐藏打印窗 / spare view / slides 分离窗 / presenter) 🟡
- **解法**:fork 有多实例机制(`launchType:specified` + onAcceptWant,hos_vscodium 已用);**隐形/辅助窗口**(printToPDF 的隐藏窗、预热 spare sheets view)属同进程 WebContentsView,POC-3/7 验证;presenter 全屏走 fork 的窗口最大化 + renderer fullscreen API。
- **原理**:WebContentsView 是同进程内多 webContents,与"多 Ability 窗口"是两回事,前者不依赖 ozone 的多窗路由,预期可用性更高。

---

## L5 文件系统与沙箱模型(A 路线最大红利区,亦有三个坑)

### 5.1 打开/保存:绝对路径直读直写 🟢(红利)/🟡(授权)
- **红利**:fork + `HOME=/storage/Users/currentUser` + 文件权限族(READ_WRITE_USER_FILE/三目录/FILE_ACCESS_PERSIST)下,GenOffice 的"绝对路径 + node:fs"模型**原样工作**——dialog.showOpenDialog 返回路径 → fs 读写。这是 B 路线要重写 419 个 IPC 而 A 路线零改动的根本原因。
- **坑**:①fork 的 dialog 实现样式/行为待 POC-7;②首次全盘授权流程(hos_vscodium 的 requestFullDiskAccessOnce 模式)要在 shim/ArkTS 层接好;③`ACCESS_USER_FULL_DISK` M1 不申请时,文件范围收敛到 Download/Documents/Desktop + picker URI——**需要验证 fork dialog 在无全盘权限时是否自动走系统 picker**。
- **原理**:hos_vscodium README 明示:删掉 FULL_DISK 后"文件对话框走系统 picker 仍可工作"。

### 5.2 资产生命周期(markdown/html 的 `assets/` 同目录写) 🟢
- **解法**:文档保存于用户目录(可写),assets 同目录写在沙箱模型下与桌面一致;仅当用户从只读位置打开(系统示例等)时失败——桌面同样失败,非新问题,错误提示已有。

### 5.3 回收站 / reveal / openPath 🟡
- **解法**:POC-7 验证 fork 的 shell.trashItem/showItemInFolder/openPath;降级:删除=确认框+永久删除;reveal 隐藏入口;openExternal 用系统浏览器 Want(adapter 大概率有)。

### 5.4 文件关联("用 GenOffice 打开")🟢(模板成熟)
- **解法**:module.json5 skills 声明(office 模板:entities 留空 + UTD 逐条枚举 + linkFeature FileOpen,六种格式)→ EntryAbility 收 want.uri → 转业务 argv(cmdArgs 机制)→ shim 转发 → GenOffice 的 `open-documents` 注册表 + `requestSingleInstanceLock` 二次实例路由自然接管。
- **原理**:fork 已实现 Want→argv 通路(hos_vscodium 32 种 UTD);GenOffice 的单实例协议是 Electron 原生事件,与 OS 层解耦。

---

## L6 原生二进制

### 6.1 Rust xlsx-sidecar 交叉编译 ✅(本机部分完成,2026-09-19 实测)
- **实测发现**:`cargo tree --target aarch64-unknown-linux-ohos` 显示依赖树**并非纯 Rust**——`ironcalc v0.7.1 → zip v0.6.6(默认 feature)` 拉入 `bzip2-sys`/`zstd-sys`(C 库,经 `cc` 编译);我们自己的 `zip="4"` 已是 deflate-only,但 ironcalc 的旧 zip 绕不开(`default-features=false` 无效,已试验)。
- **实测结果(NDK CC 路线一次通过)**:
  ```
  CC_aarch64_unknown_linux_ohos = $NDK/llvm/bin/aarch64-unknown-linux-ohos-clang
  AR_aarch64_unknown_linux_ohos = $NDK/llvm/bin/llvm-ar
  CARGO_TARGET_AARCH64_UNKNOWN_LINUX_OHOS_LINKER = 同 CC
  cargo build --release --target aarch64-unknown-linux-ohos     # 48.5s ✓(bzip2/zstd C 代码一并编过)
  # + RUSTFLAGS="-C target-feature=+crt-static"                 # 49.4s ✓
  ```
  - 动态版:ELF aarch64,interpreter=/lib/ld-musl-aarch64.so.1,11MB;
  - **静态版(crt-static):无 NEEDED、无 INTERP,真静态** —— D6 目标形态,不依赖系统 loader,支撑"HAP 不声明 LOAD_INDEPENDENT_LIBRARY"的验收;
  - **host 版 stdio 协议烟测 ✓**:`open` 命令返回完整 workbook 元数据(zip→calamine/ironcalc 全链正常),JSON-lines 双向通信工作;read_range 的 CellRange 参数结构细节以 `xlsx-sidecar-client.ts` 为准,留集成测试。
- **剩余(真机)**:spawn 的 stdio 管道行为(executableBinaryPaths 注册后)、性能实测。
- **原理**:aarch64-unknown-linux-ohos 是 Rust 官方 tier-2 target;cc crate 按 `<CC>_<target>` 约定取交叉编译器;bzip2/zstd 无平台 ifdefs;stdio JSON 协议平台无关。

### 6.2 pdfium/harfbuzz wasm(Node 主进程)✅(host 预验完成,2026-09-19)
- **实测结果**(`scripts/poc5-wasm-smoke.mjs` + `poc5-hb-smoke.mjs`,在 genoffice-e37 的 Node 22 环境,调用链照抄 genoffice 真实用法):
  - **pdfium.wasm**:init + `PDFiumExt_Init` → `FPDF_LoadMemDocument`(注意封装签名是 `(ptr,size,passwordPtr)` 三参)→ 页数 → **文本提取正确**("Hello GenOffice OHOS")→ `PDFiumExt_OpenFileWriter`(0 参,内存 writer)+ `SaveAsCopy` → 698 字节合法 PDF 写回。**全链可用**;
  - **harfbuzz.wasm**:factory({wasmBinary}) → blob/face/upem(2048)/font/scale → `hb_buffer_add_utf16`+`hb_shape`:latin 实测 glyph id + x_advance 正确;Arabic/Devanagari 全 .notdef = **coverage-check 语义正确**(Carlito 无该文字字形,真机走系统字体,与 shaped-metrics.ts 设计一致);
  - **hb-subset.wasm**(注意新版位置在 `dist/harfbuzz-subset.wasm` 而非包根):Carlito 631712 → 461024 bytes,保留 layout features,sfnt tag 合法。
- **原理与外推**:fork 主进程是完整 Node 22(V8),wasm 是字节码层、与 CPU 架构无关——host x64 的通过结论可外推到真机 arm64(POC-3 时抽一个 PDF 打开做 spot check 即可)。剩余风险仅内存上限(大 PDF)与 fork 进程环境差异,真机冒烟覆盖。

### 6.3 OCR 🟢(降级内置)
- swift/win helper 裁掉;`packages/pdf2docx/src/ocr.ts` 的引擎注入抽象走 Linux 无引擎路径(优雅降级为位图,上游已实现);M2+ 可评估 ArkTS 桥接 Vision Kit。

---

## L7 字体与文本保真(产品卖点所在,最需要基线管理)

### 7.1 度量与绘制的三角关系 🟡→需基线
- **问题**:度量在主进程读字体文件(opentype.js),绘制在 renderer 由 Chromium 按家族名解析——两者必须指向同一物理字体,否则分页/换行与桌面版漂移(附录 A §7)。
- **解法**:
  1. **捆绑字体兜底**(一致性保底):Carlito(Calibri 替身)+ docs 内嵌 Liberation/Caladea/Noto 子集随包分发,主进程度量目录与 renderer @font-face 用同一批文件 → 关键路径字体**强制一致**;
  2. **系统字体增强**:OHOS 系统字体目录(实测:/system/fonts,native 可读——Electron 主进程 fs 即 native,预期可读,POC-6 验证)注入度量扫描路径(环境变量,不改 FONT_TABLE 源码);
  3. renderer 侧 Chromium 的系统字体回退由 fork 的字体配置决定,POC-6 用视觉回归对比桌面版基线。
- **原理**:捆绑字体消除三角不确定性的成本最低、效果最确定;系统字体是锦上添花。**byte-fidelity 卖点要求 M1 就建视觉基线**(用 GenOffice 现有 fixtures 文档集截图对比)。

### 7.2 CJK 🟡
- docs 内嵌 Noto CJK 子集(已有);slides 依赖字体 CDN(INTERNET 可达);Sheets 的 Univer 渲染用系统字体(OHOS 自带 HarmonyOS Sans SC)。POC-6 建基线时覆盖中文文档全模块。

---

## L8 打包与分发

### 8.1 HAP 体积 🟡
- **估算**:libelectron 170MB + 引擎 resfile 18MB + genoffice 资源(六模块 out ~150-250MB + node_modules 运行时 + 字体 12MB + wasm 数 MB + sidecar ~10-20MB)≈ **400-600MB**(compressNativeLibs=false 使 so 段不压缩)。
- **解法**:M1 量化实际值;瘦身手段(renderer 产物按需分包、CDN 化非核心字体、 locales 裁剪只剩 zh-CN/en-US);AGC 上架的包体限制(单 HAP 4GB)不构成门槛,但安装体积影响转化。
- **原理**:hos_vscodium 的 HAP(VSCodium 284MB 资源 + 193MB 引擎)已在真机安装运行,量级相同。

### 8.2 构建链固化(纪律项)🟢
- 一键脚本:`build-web.sh`(npm 七包构建)→ `pack-app.mjs`(装配 resfile:shim 注入、sidecar/wasm 拷贝、产物断言)→ `devecocli build`(hvigor)→ 签名 → `deploy-ohos.sh`(hdc install 文本匹配验收,office 模板);**毁灭性重建演练**为验收标准(用户全局原则 + office 项目方法论)。

### 8.3 更新与版本 🟢(先裁后补)
- electron-updater(35KB 状态机)shim 打桩为"始终最新";版本号单一数据源 = AppScope/app.json5(office 教训:曾因双数据源漂移出 About 显示错版本);AGC 应用内更新 M2。

---

## L9 系统能力桥接杂项

| 能力 | 现状/解法 | 置信度 |
|---|---|---|
| 剪贴板(文本/图片) | fork adapter 是否实现 Electron clipboard 待验;降级:纯文本走 ArkTS 桥 | 🟡 |
| 拖放打开(webUtils) | 待验;降级:文件 → 打开按钮(入口已有) | 🟡 |
| 深色模式(nativeTheme) | fork 待验;降级:应用内主题切换已有(独立于 OS) | 🟢(降级无损) |
| 打印 | L2.3 备选链;最终一公里 `@ohos.print`(office 实证,PRINT 权限声明即得) | 🟡 |
| Zotero / codex / gsk CLI | 本机服务/CLI,沙箱内无 → 裁剪(功能位隐藏,不报错) | 🟢 |
| GA4/字体 CDN/AI 网络 | 纯 fetch + INTERNET 权限,直通 | 🟢 |

---

## L10 测试与验收体系

- **单测**:引擎包 14 万行 vitest 原样保留(POC-2 实证跑通于 node22 环境)。
- **e2e 重建**:fork 的 remote-debugging(9333)→ Playwright `chromium.connectOverCDP` 直连 renderer 做 UI 自动化(脚本从 51 个现有 spec 移植核心 15-20 个);主进程侧用启动参数门控 + 沙箱日志探针(office 模式)。
- **验收门**:每个 POC 有明确判定;M1 出厂 = smoke 全绿 + 六模块各一份真实文档的打开/编辑/保存/导出回归 + 视觉基线对比。

---

## 11. 修正后的 POC 清单(并入新发现验证点)

| POC | 新增验证点(本轮分析发现) |
|---|---|
| POC-3 | + `process.platform` mock 后的启动即崩扫描;worker_threads;fs.watch(recursive);localhost listen;clipboard;**IME 三编辑器实测前置到这里** |
| POC-4 | + `cargo tree` 零 C 依赖断言;spawn 的 stdio 管道行为 |
| POC-5 | (不变)wasm 三件套;**可先在 host x64 node22 预验** |
| POC-6 | + /system/fonts 主进程可读性;视觉基线(含 CJK 全模块) |
| POC-7 | + frameless/WCO、Menu/dialog 呈现、shell.trashItem/openPath、printToPDF、capturePage、无全盘权限时 dialog 行为 |
| **新增 POC-8** | **Playwright connectOverCDP 连 fork remote-debugging 的可行性**(决定 e2e 重建路线,可与 POC-3 同机做) |

## 12. 工作量重估(相对 PORT_DESIGN 初版)

| 阶段 | 初版估计 | 细化后 | 变化原因 |
|---|---|---|---|
| M0 | 2-4 周 | **2-3 周** | POC-2 已完成且零断点;权限已确认;Rust 工具链就绪 |
| M1 | 1-2 月 | **1.5-2.5 月** | L4(窗口 chrome)+ L2.3(printToPDF 备选链)+ IME 实测结果三处不确定,每处都可能 +1-2 周 |
| M2 | 1-2 月 | 1-2 月 | 不变(触屏适配为主导) |

**结论**:静态层零断点把 M1 从"适配+重写混合"变成"纯集成+验证",但 L2.3/L4.1/IME 三项 🟡/🔴 是 M1 的真实变数,它们的验证(POC-3/7)应尽早排期,不要等 M0 其他项。
