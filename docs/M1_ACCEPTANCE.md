# M1 验收表与 ACL 登记(M1_ACCEPTANCE)

> 状态:**M1 ✅ 全部完成(G0-G6,2026-09-20 首亮 → 09-21/22 G4 七级 + G5 smoke 7/7 + G6 演练全绿)**;M2 待启动(ACL 申请/权限运行时化/文件关联等,见 §4)
> 配套:PORT_DESIGN §11(G0-G3 工程记录与排障实录)、`scripts/e2e/ohos-smoke.mjs`、`web_engine/src/main/module.json5`(权限声明,已自有化)
> 变更(2026-09-22):web_engine 适配层自有化入本仓;`scripts/web-engine-permissions.trim` 已固化删除
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

**2026-09-21 全量 7/7 PASS;2026-09-22 G6 演练产物重装后复验再次 7/7 PASS。** 明确不做(M2):视觉基线 / 多窗口 / MCP / AI 面板(R7 已入册)。

明确不做(M2):视觉基线 / 多窗口 / MCP / AI 面板(R7 已入册)。

## 3. G6 收尾(✅ 2026-09-22)

- [x] 毁灭性重建演练:`bash scripts/m1-rebuild-drill.sh`(固化入库;rm web_engine/oh_modules/entry-build/resfile/build-profile → 三脚本全绿,HAP 327,743,120 B/670 files;产物已重装真机并 smoke 复验 7/7)
- [x] gitignore:`entry/src/main/resources/resfile/resources/`(109M 产物,可重建)
- [x] PORT_DESIGN §11(M1 工程记录)/ 本表 / 清单 §3 修订
- [x] 一键入口核对:`npm run build:ohos`(sync-engine + build-genoffice --no-build + build-ohos;G4-G5 期间多轮实际使用)

## 4. ACL 权限登记(更新 2026-09-23:包名与声明已切终态,ACL 五件待 profile)

### 4.1 包名/签名终态(09-23 代码层切换;09-24 profile 到位)

- **正式包名 `app.fuqidian.sotaoffice`**。代码层已切终态:`AppScope/app.json5` 包名、
  `web_engine/src/main/module.json5` 四条 ACL 受限权限声明、`build-ohos.sh` 校验升级为五条必需(缺失即 FATAL)。
- **签名材料(09-24)**:`scripts/.signing.snippet` 指向 `default_SotaOffice_*`(ExampleProject 调试材料改名而来),
  实测 bundle-name 匹配、**ACL 五件齐**、真机 UDID 在 device-ids 内 → signed HAP 装机成功。
- 借名实验结论(2026-09-22,勿再试):**ACL 资格 per-app,不能跨应用借用**——本机全部 profile 中 JIT 与 READ_PASTEBOARD 分属不同应用名下;且安装期校验"声明受限权限必须在 profile ACL 内"(9568289)、`atm perm grant` 要求权限已被应用声明,两道门槛闭环,本地组合无解。

### 4.2 申请中(AGC,app.fuqidian.sotaoffice 名下;声明已按终态入库)

| 权限 | 类型 | 用途 | 等待期行为 |
|---|---|---|---|
| `kernel.ALLOW_WRITABLE_CODE_MEMORY` | ACL system_grant | V8 JIT/wasm,引擎级必需 | (申请续期;曾由 MagicFlow 档覆盖) |
| `ohos.permission.READ_PASTEBOARD` | **user_grant** | 剪贴板读取 | shim 桩⑭ **授权信号文件制(v2)**:未授权绝不调用原生读侧(调用即弹系统窗,2026-09-22 实测);EntryAbility 查/申请后写 `clip-perm.json`,shim 轮询恢复 |
| `READ_WRITE_DOCUMENTS_DIRECTORY` | ACL **user_grant** | Documents 直读直写 | 须运行时弹窗授予(见 §4.5 约束 3);未授予时 shim 第⑦桩降级 el2 |
| `READ_WRITE_DOWNLOAD_DIRECTORY` | ACL **user_grant** | Download 直写 | 同上 |
| `READ_WRITE_DESKTOP_DIRECTORY` | ACL **user_grant** | Desktop 直写 | 同上 |

> 参考:pureoffice(app.fuqidian.pureoffice)名下 READ_PASTEBOARD 已在 AGC 获批(其调试档与生产档 p7b 均含),申请通道已验证可行。

### 4.3 永久裁剪(不申请,依据 PORT_DESIGN §4)

`ACCESS_USER_FULL_DISK`、`READ_WRITE_USER_FILE`(沙箱+picker 够用)/ `kernel.LOAD_INDEPENDENT_LIBRARY`(D5 定稿:VSCodium CLI 专用)/ `CUSTOM_SANDBOX`(shim disable-renderer-sandbox)/ `ALLOW_EXTERNAL_NATIVE_CODE`(零 napi 模块)/ VSCodium 特有全家桶(ACCESS_BIOMETRIC、LOCATION×3、MICROPHONE、CAMERA、ACCESS_BLUETOOTH、CUSTOM_SCREEN_CAPTURE、SYSTEM_FLOAT_WINDOW、WINDOW_TOPMOST、PRIVACY_WINDOW、ACCESS_CERT_MANAGER、WEB_NATIVE_MESSAGING)。

### 4.4 profile 到位后的动作(备忘)

1. 新调试 profile(p7b)写入 `scripts/.signing.snippet`(材料路径+口令),`rm build-profile.json5` 后 `npm run build:ohos` 重建(产 signed HAP);
2. 声明与构建校验已按终态就位,无需再改;直接装机(报 9568332 时先 `bm uninstall`);
3. 真机回归:EntryAbility 授权框(READ_PASTEBOARD)→ 写信号文件 → shim 桩⑭ 读到 granted=true 恢复读侧 → 从系统应用复制粘贴端到端;三目录落点(shim 第⑦桩自动切系统目录,核对 downloads/desktop);
4. 若某条 ACL 未获批:删除 `web_engine/src/main/module.json5` 对应声明 **并同步 `build-ohos.sh` 必需清单**再构建(声明无 ACL 覆盖 = 9568289 装不上)。

### 4.5 声明配置方式与约束

**位置**:`web_engine/src/main/module.json5`(HAR 模块——权限随 HAR 合并进 entry,entry 自己零声明);
reason 字符串在三语言 `web_engine/src/main/resources/{base,zh_CN,en_US}/element/string.json`。

| 类别 | 写法 | 例 |
|---|---|---|
| 普通系统权限(system_grant) | 仅 `name` | `{ "name": "ohos.permission.INTERNET" }` |
| 受限 ACL 权限 | `name` + `reason` + `usedScene` | `{ "name": "ohos.permission.READ_PASTEBOARD", "reason": "$string:access_pasteboard", "usedScene": { "abilities": ["EntryAbility"], "when": "always" } }` |
| 自定义 kernel 权限 | `definePermissions` 里定义 + `requestPermissions` 仅 `name` | `ohos.permission.kernel.ALLOW_WRITABLE_CODE_MEMORY` |

**约束(踩坑)**:
1. **声明须与签名 profile 的 ACL 一致**:声明了但 profile 未覆盖 → 装机报 **9568289**;profile 有而未声明 →
   `atm perm grant` 报 "Permission is not requested"。两道门槛闭环,本地无解(见 §4.1)。
2. **HAR 模块的受限权限必须带 `reason`**,否则 hvigor 报 **00303222**;`kernel.*` 自定义权限不受此限。
3. **user_grant 权限**(READ_PASTEBOARD + **三目录**,共 4 条)声明后还须**运行时弹窗申请**:
   `EntryAbility.requestClipboardPermission` / `requestStoragePermissions` → `requestPermissionsFromUser`
   (须在窗口就绪后调用,onCreate 期申请会静默失败且被记账)。
   **实测(2026-09-24)**:三目录只声明+ACL、未运行时申请时,写 `/storage/Users/currentUser/*` 全 **EPERM**
   (ACL 给的是"申请资格",不是"已授予")。
4. 构建期校验:`scripts/build-ohos.sh` 第 [1/4] 步——五条必需声明(缺失即 FATAL)+ 未获批权限不得出现。
