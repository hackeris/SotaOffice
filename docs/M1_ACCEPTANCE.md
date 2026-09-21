# M1 验收表与 ACL 登记(M1_ACCEPTANCE)

> 状态:**G0-G3 ✅ 首亮(2026-09-20)** · G4 进行中(0/7 级已过;2026-09-21 排障双坑已修,shim v6,见 PORT_DESIGN §11.6) · G5/G6 待做
> 配套:PORT_DESIGN §11(G0-G3 工程记录与排障实录)、`scripts/e2e/ohos-smoke.mjs`、`scripts/web-engine-permissions.trim`
> 纪律:每级人工操作 + CDP 证据双轨;截图归档 `docs/appendix/m1-screenshots/`;连续通过才进下一级

---

## 1. G4 逐模块点亮验收(复杂度递增)

| # | 目标 | 验收点 | 状态 | 证据/备注 |
|---|---|---|---|---|
| 0 | 壳/Home | CDP:home target 存在;`.home-hero` 非空;`.quick-card`=7;截图无豆腐块;菜单栏渲染(人工) | ✅ 2026-09-20 | `g4-0-home.png`:hero✓ cards=7 全中文;6 进程树;**原生菜单栏表现待观察(D6 风险)** |
| 1 | markdown | 新建 → 中文输入 → 预览渲染 → 保存 → 重开;printToPDF 导出 | 🔶 | **CDP 自动轨 2026-09-21**:新建✓ TipTap 中文输入✓(无豆腐)exportPdf `{ok:true}`✓ 系统 picker✓,导出件经 Home 重开进 PDF 模块渲染✓;**待人工**:真机 IME 体验、WYSIWYG 语法转换(InputRules 需真实键盘);自动保存→重开 .md 闭环未跑;fork 缺陷:save dialog defaultPath 文件名不回填(§11.6) |
| 2 | html | 新建 → 预览/编辑切换 → 保存 .html → 导出 PDF | ✅ 2026-09-21 | CodeMirror 中文源码✓ 预览/源码切换✓(iframe 渲染:h1/粗体/列表全对)exportPdf `{ok:true}`✓ |
| 3 | docs | 打开中文 docx → 渲染 → 编辑 → 另存 → 导出 PDF;**关 tab 回归**(tab-manager detach workaround,37 行为差) | ✅ 2026-09-21 | ProseMirror 中文输入✓ 另存(状态栏"已保存")✓ **关 tab 回归✓**(判据=tab bar DOM;docs 走 teardown 不 close,orphan webContents 保留属上游设计)Home 重开解析渲染✓(48 字全回,字体未装自动替代提示)exportPdf `{ok:true}`✓;**输入死区已修**(shim 桩⑬) |
| 4 | pdf | 打开中文 PDF → pdfium.wasm 渲染 → 文本选择 → 导出;hb-subset 载入 | ✅ 2026-09-21 | 经 markdown 导出件打开✓ canvas×3(pdfium)✓ 中文文本层完整✓ 工具栏全中文✓;待人工:文本选择/注释手感;坚盾模式 FAIL 属预期(登记不修) |
| 5 | sheets | 新建 → 公式 → **存 xlsx 触发 sidecar**(shim-log `spawn remap hit` + ps 见进程)→ 重开 | ✅ 2026-09-21 | 自动保存开启→**ps 实证 `xlsx-sidecar` 进程运行**(Rust 引擎真机首验,spawn remap 桩工作)Home 重开 xlsx✓ |
| 6 | slides | 新建/打开 pptx → 画布(Konva)→ 文本编辑 → 导出 PDF → 全屏 | ✅ 2026-09-21 | Konva canvas×3✓ addElement 中文文本框(数据层 nodes:1)✓ 文件→导出为 PDF(UI)→**自动打开导出件**(16:9 横页,PDF 模块渲染)✓ **全屏放映✓**(黑底 letterbox+页码)退出✓;剪贴板弹窗已修(桩⑭);字体选择器待人工观察(/system/fonts 缺口见 PORT_DESIGN 字体节) |

## 2. G5 e2e smoke(7 用例,`node scripts/e2e/ohos-smoke.mjs`)

| 用例 | 断言 | 状态 |
|---|---|---|
| boot | 靶列表含 home | ✅ |
| home | hero + quick-card≥5 + 截图>50KB | ✅ |
| markdown-edit | Input.insertText 中文后 DOM 命中 | ✅(选择器须 .ProseMirror 优先,AI 输入框 textarea 会抢通配匹配——坑已注) |
| docs-open | genoffice-app://docs 靶存在 | ✅ |
| docs-export-pdf | 导出 PDF ≥30KB 且 %PDF 头 | ✅(fork 无 CDP Page.printToPDF,改走 `desktop.printPdfBuffer` 主进程 IPC;61KB=短文档合理值) |
| sheets-sidecar | sidecar 进程存活 | ✅(shim-log 在 hdc shell 下不可读,以 ps 为准) |
| pdf-wasm | 页码/画布指示非空 | ✅ |

**2026-09-21 全量 7/7 PASS。** 明确不做(M2):视觉基线 / 多窗口 / MCP / AI 面板(R7 已入册)。

明确不做(M2):视觉基线 / 多窗口 / MCP / AI 面板(R7 已入册)。

## 3. G6 收尾

- [ ] 毁灭性重建演练:`rm -rf web_engine oh_modules entry/build entry/src/main/resources/resfile/resources build-profile.json5` → `sync-engine.sh && build-genoffice.sh && build-ohos.sh` 全绿
- [x] gitignore:`entry/src/main/resources/resfile/resources/`(109M 产物,可重建)
- [x] PORT_DESIGN §11(M1 工程记录)/ 本表 / 清单 §3 修订
- [ ] 一键入口核对:`npm run build:ohos`(sync-engine + build-genoffice --no-build + build-ohos)

## 4. ACL 权限登记(用户决策 2026-09-20:**CODE ACL 已有,其余暂时避开,后续申请**)

### 4.1 已有

| 权限 | 状态 |
|---|---|
| `ohos.permission.kernel.ALLOW_WRITABLE_CODE_MEMORY` | ✅ 已有(MagicFlow 调试证书 profile 覆盖,真机放行——V8 JIT/wasm 依赖它,真机 A8 已证) |

### 4.2 待申请(**M2 时点**;M1 期间保持裁剪、降级路径运行)

| 权限 | 用途 | M1 降级路径(已在跑) | 产品影响 |
|---|---|---|---|
| `ohos.permission.READ_PASTEBOARD` | 剪贴板读取 | readText 返回空(writeText 不受影响);**shim 桩⑭ 读侧静默(2026-09-21)**:未授权时 fork 走 @ohos.pasteboard 会触发系统弹窗,slides focus 轮询 probe 造成反复弹窗——桩把读侧 API 钉空,弹窗消除;**申请落地后需移除桩⑭**(shim 注释已标) | 应用外复制的内容粘不进来(读取侧) |
| `ohos.permission.READ_WRITE_DOCUMENTS_DIRECTORY` | Documents 直读直写 | shim 桩:不可写时 `app.setPath('documents', el2/Documents)`;打开/保存走系统 picker | 默认保存目录在沙箱;Home 文件夹树扫不到用户真实文档 |
| `ohos.permission.READ_WRITE_DOWNLOAD_DIRECTORY` | Download 直写 | 下载默认名落 el2 | 导出落点在沙箱 |
| `ohos.permission.READ_WRITE_DESKTOP_DIRECTORY` | Desktop 直写 | 同上 | 同上 |

### 4.3 永久裁剪(不申请,依据 PORT_DESIGN §4)

`ACCESS_USER_FULL_DISK`、`READ_WRITE_USER_FILE`(沙箱+picker 够用)/ `kernel.LOAD_INDEPENDENT_LIBRARY`(D5 定稿:VSCodium CLI 专用)/ `CUSTOM_SANDBOX`(shim disable-renderer-sandbox)/ `ALLOW_EXTERNAL_NATIVE_CODE`(零 napi 模块)/ VSCodium 特有全家桶(ACCESS_BIOMETRIC、LOCATION×3、MICROPHONE、CAMERA、ACCESS_BLUETOOTH、CUSTOM_SCREEN_CAPTURE、SYSTEM_FLOAT_WINDOW、WINDOW_TOPMOST、PRIVACY_WINDOW、ACCESS_CERT_MANAGER、WEB_NATIVE_MESSAGING)。

### 4.4 申请落地时的动作(备忘)

1. AGC 提交 READ_PASTEBOARD + 三目录(办公场景理由);审批周期数周,**与开发并行**;
2. 调试 profile(p7b)随 ACL 重发;覆盖安装报 9568332 时先 `bm uninstall`;
3. `scripts/web-engine-permissions.trim` 加回对应条目 → 重装实测(shim 第⑦桩 documents 探测会自动改走系统目录,无需改代码);READ_PASTEBOARD 落地后**需同步移除 shim 桩⑭(剪贴板读侧静默)**,否则系统剪贴板内容仍读不进来;
4. 真机回归:自检 A4(clipboard)/ sheets 保存落点 / Home 文件夹树。
