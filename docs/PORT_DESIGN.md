# GenOffice → HarmonyOS 移植设计(PORT_DESIGN)

> 状态:**已定稿**(2026-09-19,关键决策经逐项确认)
> 分区:移植方案 | 目标:HarmonyOS PC(2in1)优先
> 配套文档:`docs/appendix/`(三份源码级分析报告)、后续 `KEYPOINTS.md`(不可变决策+踩坑)、`FEATURE_MATRIX.md`(能力矩阵+验收)

---

## 0. 结论先行(不可推翻决策)

| # | 决策 | 状态 | 依据 |
|---|---|---|---|
| D1 | **路线 A:Electron-on-OHOS**(openharmony-sig/electron `v37.2.0-openharmony` 运行时,Chromium 138 + Node 22.17) | ✅ 定稿 | GenOffice 是"重 Node 主进程"应用(419 IPC + 4 scheme + printToPDF + WebContentsView + 内嵌 HTTP 服务),B 路线(ArkTS 壳重写)成本人年级;hos_vscodium 已真机验证同级复杂度应用可跑 |
| D2 | **PC(2in1)优先**;fork 的 `web_engine` HAR `deviceTypes` 仅 `["tablet","2in1"]`,**手机不在 fork 支持面** | ✅ 定稿 | fork 窗口层(ozone-ohos)面向大屏;手机若做需另行评估(B 路线或等上游) |
| D3 | **版本策略:GenOffice 降级适配 Electron 37**(不升级 fork 到 43) | ✅ 定稿 | 升级 fork = 自编译 Chromium(>200G 磁盘/>32G 内存);降级清点可本机无设备并行(POC-2) |
| D4 | 发布侧 kernel ACL 目标**仅 1 条**:`kernel.ALLOW_WRITABLE_CODE_MEMORY` | ✅ 已确认可得 | V8 JIT 的 W^X 内存页,Electron 运行时唯一硬需求;场景对口官方定义"自带引擎的即时编译" |
| D5 | `kernel.LOAD_INDEPENDENT_LIBRARY` **从必需清单移除**:它是 VSCodium 内置 CLI 工具(bash/zsh/rg)的需求,不是 Electron 运行时需求(libelectron.so 走 HAP so 签名体系装载) | ✅ 定稿 | 用户澄清 + 机制分析;POC-4 以"静态链接 sidecar + HAP 不声明该权限"实测佐证 |
| D6 | Rust xlsx-sidecar **静态链接**(musl crt-static)后走 `executableBinaryPaths` 注册 + spawn,stdio JSON 协议零改动 | ✅ 定稿 | 上游 Windows 版已 crt-static;规避独立库装载权限问题 |
| D7 | 文档/构建产物可复现纪律:所有产物不入库、一键重生成脚本、毁灭性重建演练、版本号单一数据源 | ✅ 沿用 | Pure Office 方法论 + 用户全局构建可复现原则 |

---

## 1. 背景与对象

**GenOffice**(`/data/share/smartoffice/.temp/genoffice`):开源 AI Office 套件(Docs/Sheets/Slides/PDF/Markdown/HTML + AI 面板),Electron 43.3 + Node ≥22.12 + npm workspaces monorepo,约 55 万行 TS(渲染层 35.5 万 + 主进程 5.4 万 + 引擎包 14.3 万)。

对移植关键的仓库特征(详见附录 A):

- **渲染层 100% 纯 Web**:全仓 renderer `from 'electron'` 零命中,React 19 + DOM + Canvas(TipTap/Univer/Konva/PDF.js/CodeMirror),构建产物为纯静态资源;
- **零 napi/.node 模块**——避开 fork 已知最深的坑(ObjectWrap 构造崩溃、napi-dyn 转发需求);
- 二进制依赖仅:xlsx-sidecar(Rust,stdio JSON-lines 子进程)、pdfium/harfbuzz wasm×3(跑在 Node 主进程)、2 个平台 OCR helper(有 Linux 无引擎优雅降级路径);
- 最大负担:419 个 `ipcMain.handle`、7 组 preload `window.*` API、4 个自定义 scheme、WebContentsView 多标签、printToPDF、菜单/单实例/updater。

## 2. 选型论证(A vs B)

| 维度 | A:Electron-on-OHOS(选定) | B:ArkTS 壳 + ArkWeb(Pure Office 模式) |
|---|---|---|
| 主进程 5.4 万行 | 原样跑(Node 22.17 完整运行时) | 419 IPC + 4 scheme + 打印 + 多标签逐个 ArkTS 重写 |
| printToPDF / CDP / WebContentsView | fork 内置(逐项验证) | ArkWeb 无对应,另起炉灶 |
| Rust sidecar | 交叉编译 + spawn,协议零改动 | 必须改造 NAPI .so,协议重设计 |
| wasm(pdfium/harfbuzz) | fork Node 主进程原样跑(待验证) | ArkTS 无 wasm 引擎,PDF 管线搬家 |
| MCP server / control socket | 原样跑 | 无对应,裁剪 |
| Electron 43→37 | 需清点适配(POC-2) | 无此问题 |
| kernel ACL | 需 1 条(D4) | 不需要 |
| 工作量 | **人月级** | **人年级** |

判据出处:Pure Office `ONLYOFFICE_OHOS_PORT_DESIGN.md` §2.3 早已研究过 Electron-on-OHOS 并留下结论——"目标应用深度依赖 Node 主进程/多进程/Electron API 面时,C 路线可能反而省"。GenOffice 命中该判据的极端形态。

## 3. 目标架构

```
┌─ HarmonyOS HAP(单 entry 模块 + web_engine HAR)───────────────────┐
│  entry 模块(ArkTS,继承 WebAbility/WebAbilityStage,薄壳)         │
│    ├─ executableBinaryPaths: electron, node, xlsx-sidecar(静态)   │
│    └─ module.json5 权限(见 §4,从 web_engine 裁剪)                │
│                                                                    │
│  web_engine HAR(自 hos_vscodium 整体搬用,零改动)                 │
│    ├─ libelectron.so (170MB, Chromium 138 + Node 22.17)            │
│    ├─ libadapter.so / libffmpeg.so                                 │
│    └─ resfile: pak / icudtl / snapshot / locales                   │
│                                                                    │
│  resfile/resources/app/  ← GenOffice 打包产物                       │
│    ├─ main-shim.mjs(hos_vscodium 模板定制)                        │
│    │    process.platform='linux' mock / HOME·XDG·chdir→沙箱        │
│    │    / 原生模块预加载(如需)/ updater 打桩 / WCO 打桩           │
│    ├─ out/            shell 主进程 bundle(含六模块 main,原样)     │
│    ├─ modules/*/      六个 renderer 静态产物(原样)                │
│    ├─ native/xlsx-sidecar  ← Rust aarch64-ohos 静态编译            │
│    └─ wasm/{pdfium,hb-subset,harfbuzz}.wasm                        │
└────────────────────────────────────────────────────────────────────┘
```

装载链(实证自 hos_vscodium):`WebAbilityStage → XComponent(libraryname="adapter") 装载 libadapter.so → nativeContext.runBrowser(argv) → appspawn fork `electron` 启动器 → 链接 libelectron.so → ElectronMain → 载入 resfile/resources/app/package.json 的 main(= 我们的 shim)。

## 4. 权限清单(分层,含确认结论)

**两条装载/签名体系的区分(勿混淆,D5)**:
- HAP so 签名体系:`libs/arm64-v8a/*.so` 安装时注册签名(XPM)——libelectron/libadapter/各 .so 别名模块走这条,**不需要 LOAD_INDEPENDENT_LIBRARY**;
- 二进制证书体系:`executableBinaryPaths` 注册的独立可执行文件(electron/node 启动器、xlsx-sidecar)及其工具链——**VSCodium 因内置 bash/zsh/rg 才申请 LOAD_INDEPENDENT_LIBRARY**;GenOffice 不带 CLI 工具则不申请。

| 层 | 权限 | 判定 |
|---|---|---|
| **Electron 运行时,不可谈判** | `kernel.ALLOW_WRITABLE_CODE_MEMORY` | **唯一 kernel ACL**(已确认可得;官方定义对口"自带引擎 JIT";调试证书 5.0.3+ 原生支持,POC 无阻塞) |
| | `CUSTOM_SANDBOX` / `ALLOW_EXTERNAL_NATIVE_CODE` / `WEB_NATIVE_MESSAGING` | 运行时(adapter/Chromium)需求,受限开放权限,AGC 流程申请 |
| | `INTERNET` / `GET_NETWORK_INFO`(normal) | AI 网络必需 |
| **GenOffice 应用集** | `READ_WRITE_USER_FILE` + `READ_WRITE_{DOWNLOAD,DOCUMENTS,DESKTOP}_DIRECTORY` + `FILE_ACCESS_PERSIST` | 打开/保存/另存/文件关联 |
| | `READ_PASTEBOARD` / `PRINT` / `GET_FILE_ICON` / `RUNNING_LOCK` / `PREPARE_APP_TERMINATE` | 粘贴 / 打印(system_grant 即得) / Home 图标 / 长转换防休眠 / 退出清理(杀 sidecar) |
| **显式裁剪** | `LOAD_INDEPENDENT_LIBRARY` | 不声明;POC-4 实测静态 sidecar 无需它(M3 做 CLI 生态时再申请,API 22+ 普通应用可申请) |
| | `ACCESS_USER_FULL_DISK` | M1 不申请(沙箱 + picker 够用);M2 视产品需要 |
| | 浮窗/置顶/隐私窗/cert/传感器/相机/定位/蓝牙全家 | VSCodium 特有,全裁 |

## 5. 实施计划

### M0:POC 排险(2~4 周,全部真机闭环)

| POC | 内容 | 状态 |
|---|---|---|
| POC-1 | AGC 发布侧权限申请提交(`ALLOW_WRITABLE_CODE_MEMORY` 等);审批与开发并行 | 待启动(应 M0 第一天发出) |
| **POC-2** | 本机 Linux `electron@37` 跑完整 GenOffice,产出 43→37 断点清单(typecheck + build + 六模块冒烟) | **✅ 完成(含全仓测试):类型/构建/测试三层 electron 相关断点 = 0**(typecheck+build 25 包;测试 23 包 17 直接过、6 失败全定性为环境缺件/root 假失败/jsdom 差异;运行时行为差异待 POC-3 真机)。报告 `poc2-breakage-report.md` |
| POC-0/3 | 搬 web_engine HAR + entry 骨架,空 Electron app 真机点亮;继而 GenOffice shell 真机点亮(shim + `genoffice-app://` + IPC 样例) | **✅ 真机点亮(2026-09-20,MateBook Pro S/2in1/API 26)**:完整进程树(:GPU×2/:NetworkService/:Renderer);shim-log 全链打点;自检 9 项 8 PASS 1 预期降级;详见 §9 真机实测记录 |
| POC-4 | `cargo build --target aarch64-unknown-linux-ohos`(+crt-static)编 xlsx-sidecar → executableBinaryPaths 注册 → spawn 跑通 `read_range`;**验收:HAP 不含 LOAD_INDEPENDENT_LIBRARY** | **✅ 真机闭环(2026-09-20)**:spawn 存活、exec 放行(XPM/executableBinaryPaths 实证);HAP 不含 LOAD_INDEPENDENT_LIBRARY(trim 已固化) |
| POC-5 | pdfium.wasm 在 fork Node 主进程 init + 打开中文 PDF;hb-subset/harfbuzz 同验 | **✅ 真机 spot check(2026-09-20)**:pdfium.wasm 在真机 JIT/W^X 下 init+LoadMemDocument+页数+文本提取全通 |
| POC-6 | CJK 字体:docs 内嵌 woff2 + slides 字体表 OH 版,视觉对比桌面版 | 待启动 |
| POC-7 | printToPDF / 菜单 / titleBarOverlay / 单实例 / IME 逐项摸底 → fork 能力缺口矩阵 | 待启动 |

### M1:PC 版可用(1~2 月)
**状态(2026-09-20):主体进壳首亮成功(G0-G3,见 §11);剩 G4 逐模块验收 / G5 smoke / G6 收尾,表见 `docs/M1_ACCEPTANCE.md`。**
Electron 37 适配(依 POC-2 清单)/ 文件打开保存另存 + 文件关联 / 打印 / 构建链固化(`scripts/ohos/*`,set -eo pipefail + 产物断言 + 毁灭性重建演练)/ 验收体系(启动参数门控 + 沙箱日志 + smoke 回归,替代不可用的 Playwright-Electron)。

### M2:产品化(1~2 月)
触屏/平板适配 / 多窗口验证 / 崩溃治理(crash-hook + dlclose 规避)/ 性能 / 签名上架合规(Apache-2.0 + third-party notices)。

### M3(可选)
MCP/CLI 生态(fork 上 `ELECTRON_RUN_AS_NODE` 已被 hos_vscodium 验证;届时补申请 LOAD_INDEPENDENT_LIBRARY)/ 手机形态再评估。

## 6. 风险清单

| # | 风险 | 状态/应对 |
|---|---|---|
| R1 | kernel ACL 获取 | **已解除**(D4:用户确认可得;调试证书原生支持) |
| R2 | Electron 43→37 断面 | **已解除(静态层)**:POC-2 实测 typecheck/build 零断点;残余=运行时行为差异,归入 POC-3 真机验证 |
| R3 | 文件系统模型冲突(绝对路径 + 同目录写 + 递归 watch vs 沙箱 + URI) | M1 收敛沙箱文档目录;folder-tree/watch 降级轮询或裁剪 |
| R4 | fork 引擎级缺陷(IME 个别场景 / 退出 dlclose 崩溃 / `media(hover:none)` 隐藏 UI) | 逐项绕行 + CSS 条件样式;crash-hook 定位 |
| R5 | HAP 体积(libelectron 170MB + 资源,估 400~600MB) | M1 量化;compressNativeLibs=false 的安装体积实测 |
| R6 | 字体保真三角(度量读文件 vs Chromium 按名解析)OHOS 偏差 | POC-6 视觉基线;内嵌字体优先 |
| R7 | 测试网重建(51 个 Playwright-Electron spec 不可用) | M1 smoke 体系;引擎包 vitest 单测原样保留 |

## 7. 环境与资产地图

| 资产 | 位置 | 用途 |
|---|---|---|
| **本工程(正式仓)** | **`/data/share/smartoffice`**(git;`.temp/` 仅放临时研究素材,用户定的纪律) | Electron-OHOS 壳工程 + 文档 + 一键构建链 |
| GenOffice 源 | `/data/share/smartoffice/.temp/genoffice` | 移植对象(临时副本,保持干净) |
| POC-2 工作区 | `/data/share/smartoffice/.temp/genoffice-e37` | electron@37 适配清点(临时素材,不入库) |
| 官方指导项目克隆 | `/data/share/smartoffice/.temp/ohos-sig-electron`(3.3G) | 官方文档/API 矩阵来源(临时素材) |
| hos_vscodium | `/data/share/smartoffice/.temp/hos_vscodium` | web_engine HAR + entry 骨架 + shim/napi-dyn/签名脚本,整体搬用(sync-engine.sh 源) |
| wineohos | `/data/share/wineohos` | 多实例姿势实证参考(launchType multiton) |
| Pure Office | `/data/share/office` | 交叉编译工具链(core3d/ohos-arm64.toolchain.cmake)、deploy/验收链、文档方法论 |
| OHOS SDK | `/data/share/ohos-sdk`(6.1.0,API 23) | NDK(sysroot/clang)、ets、toolchains(hdc) |
| 构建容器 | `/data/share/run_hoa_container.sh`(docker ubuntu:26.04 + command-line-tools@/apps/harmony) | hvigor/ohpm 构建环境 |
| 签名材料 | `/data/share/hap/.ohos/config/` | 调试证书(跨项目共享目录) |
| Rust OHOS | `rustup target add aarch64-unknown-linux-ohos`(ohos.rs;OHOS_NDK_HOME 指向上述 SDK) | sidecar 交叉编译 |

## 8. 附录

- `appendix/A-genoffice-architecture.md` —— GenOffice 架构与平台耦合点分析(四档分类)
- `appendix/B-pure-office-methodology.md` —— Pure Office 移植方法论(B 路线全套资产与经验)
- `appendix/C-hos-vscodium-runtime.md` —— hos_vscodium / Electron-OHOS 运行时工程细节(复用清单)

---
## 9. 工程落地记录(2026-09-19)

**鸿蒙工程骨架已搭建并构建通过**(阶段 1,POC-0 地基):

- 位置:本仓库根(`genoffice-ohos/`),参考 `/data/share/office` 结构;
- 包名/签名:**复用 comfy(MagicFlow)的 `app.fuqidian.magicflow` + `/data/share/hap/.ohos/config/default_MagicFlow_*` 调试材料**(复用条件:bundleName 与证书一致;未来独立上架时换正式包名重新生成材料);
- 构建:**当前环境即 hoa 容器**(hvigorw 在 `/apps/harmony/bin`,SDK 在 `/apps/harmony/sdk/default/openharmony`,无需另起 docker);
- 一键构建:`scripts/build-ohos.sh`(`set -eo pipefail` + HAP 存在/大小/module.json 断言),产物 `entry/build/default/outputs/default/entry-default-signed.hap`(219KB,12 files,SignHap 通过);
- 模板纪律:`build-profile.json5`(含签名,gitignore)/ `build-profile.json5.template`(无签名,入库),同 office;
- 当前 entry 为最小骨架(deviceTypes tablet/2in1,无权限声明、无文件关联——待 POC-0 后与能力同步上线)。

**POC-0 下一步**:搬 hos_vscodium `web_engine/` HAR + entry 改 Electron 壳(WebAbility/AbilityStage/CustomChildProcess + executableBinaryPaths + main-shim),装真机点亮空 Electron 窗口。

**POC-0 自检 HAP 已构建完成(2026-09-19,"就差真机安装")**:
- **形态**:按用户决策先做"验证最小功能集合"——不是空窗口,而是**一页自检 app**(frameless + 自定义 scheme `genoffice-app://` + Tray),把 POC-3/4/5 真机疑点压缩为一次真机会话:
  - 自动项 A1-A10:rawPlatform/单实例裸调行为/app.getPath 全家/clipboard 往返/printToPDF/WCO 打桩/spawn xlsx-sidecar(executableBinaryPaths+XPM 放行)/wasm pdfium 全链(POC-5 spot check)/Tray/nativeImage;
  - 人工观察:三键缺失(官方已知)/托盘/中文 IME(L2.2 最大变数)/中文字体;
  - 结果写 shim-log(/data/storage/el2/base/files/shim-log.txt)+ 9333 远程调试通道(dev_config.json 已入包)。
- **三脚本一键链**(可复现,毁灭性演练已通过:rm web_engine+oh_modules+build 产物+build-profile 从零全绿):
  1. `scripts/sync-engine.sh`——web_engine HAR(193MB)整体同步 + entry libs 必需件(electron/node 启动器、libc++_shared、dev_config.json;bash/zsh/rg/.node 别名已按清单 §11 筛除);
  2. `scripts/build-app.sh`——自检 app 资产(sidecar 断言 aarch64 静态无 INTERP、pdfium wasm、icon);
  3. `scripts/build-ohos.sh`——ohpm install → template+签名注入(node 文本替换,snippet gitignore)→ hvigor assembleHap → **18 关键件内容断言**(so×3/启动器×2/sidecar/dev_config/resfile 资源/app 五件套,libelectron>100MB 防 LFS 指针)。
- **产物**:`entry-default-signed.hap` 220,715,186 bytes(39 files),MagicFlow 调试签名(SignHap 通过——**web_engine 38 条权限含 kernel ACL 均过签名**,说明该调试证书 profile 覆盖 ACL,POC 阶段无阻塞)。
- **entry 壳**:MyAbilityStage/EntryAbility/BrowserAbility/StatelessAbility(+TaskManager/StatusBar/BrowserEmbedded)+ CustomChildProcess(toString 注册)+ pages 8 件 + ability 三件套命名(kAbilityMap 约束)+ multiAppMode 三件套,清单 §2/§3 十二步全落实。
- **演练抓到的缺口(已修)**:①hvigor 不自动 ohpm install(Cannot find module 'web_engine' 22 连错)→ 固化进脚本;②template 落后(缺 web_engine 注册)→ OhmUrl 15 连错 → 重建 template+签名注入机制;③签名口令只存在 build-profile.json5 里,rm 后险些丢失 → .signing.snippet(gitignore)单点保存。
- **真机步骤**(等设备):`hdc app install entry-default-signed.hap`(9568332 先 bm uninstall)→ 桌面开 GenOffice → 自检页"全部运行" → 逐项记录;IME/三键/托盘人工勾选;`hdc fport tcp:9333` 连 Playwright/DevTools;崩溃看 shim-log + hilog(包名/APPSPAWN 定位法,清单 §7)。

## 10. 真机实测记录(2026-09-20,MateBook Pro S MOR-M1 / 2in1 / API 26)

**POC-0/3/4/5 一次闭环:自检 HAP 安装、点亮、CDP 远程自检全部完成。**

### 10.1 自检结果(9 项:8 PASS + 1 预期降级)

| 项 | 结果 | 实测结论 |
|---|---|---|
| 装载链 | ✅ | 完整进程树:主进程 + `:GPU`×2 + `:NetworkService` + `:Renderer`;shim-log 全链打点(main-shim 六件事 → main.mjs loaded → app ready) |
| A1 probe | ✅ | **`process.platform` 原始值 = `openharmony`**(shim 打桩必要性的实证);electron 37.2.0 / chrome 138.0.7204.45 / node 22.17.0 |
| A2 单实例 | ✅ | **`requestSingleInstanceLock()` 实际返回 true**(官方 API 矩阵标"不支持"过于悲观——API 存在且工作;shim 恒 true 打桩与系统行为一致,无双实例风险,multiton 下多开是能力不是问题) |
| A3 路径 | ✅ | home/downloads/documents/desktop 落 `/storage/Users/currentUser/*`(**系统真实用户目录**,非深沙箱——比预期更好,打开/保存对话框体验将接近桌面);userData=`/data/storage/el2/base/files`;execPath=`/system/bin/appspawn`(fork 痕迹);osType()=`HarmonyOS` |
| A4 clipboard | 🟡 降级 | writeText 后 readText 为空——**READ_PASTEBOARD 权限被裁的预期后果**;readImage 不崩。登记 M1 ACL 申请(用户确认:影响不大,先登记) |
| A5 printToPDF | ✅ | **485KB PDF,头 `%PDF-1.4`**——Chromium 打印管线全通(导出 PDF 可用;调系统打印机的 PrintAdapter 另属 TODO 半成品) |
| A6 WCO | ✅ | 三 API 打桩后调用不抛(shim 生效) |
| A7 sidecar | ✅ | **spawn 存活 3s 静默退出无错** = executableBinaryPaths 注册 + XPM 放行 + stdio 通路全通(POC-4 真机闭环) |
| A8 wasm | ✅ | **pdfium.wasm init + LoadMemDocument + pageCount=1 + 文本提取"Hello GenOffice OHOS"**(JIT W^X 内存真机工作;坚盾模式未开启) |
| A9/A10 | ✅ | Tray 存在;nativeImage 1024×1024 解码 |
| 渲染 | ✅ | CDP 截图确认:自检页完整渲染、**中文字体正常无豆腐块**、frameless + 自绘标题栏 + `genoffice-app://` scheme 加载 |
| 9333 通道 | ✅ | dev_config.json 生效,`hdc fport` + CDP `/json/list` + WebSocket 远程执行全通——**e2e 测试网可重建**(Playwright connectOverCDP 就绪) |

### 10.2 真机暴露并已修的问题(踩坑实录)

| # | 问题 | 症状/证据 | 修复 |
|---|---|---|---|
| T1 | **ACL 权限安装拦截** | `9568289 grant request permissions failed`:ACCESS_USER_FULL_DISK → READ_PASTEBOARD 逐条被拒(MagicFlow 调试证书 profile 的 ACL 覆盖有限;**kernel.ALLOW_WRITABLE_CODE_MEMORY 经 definePermissions 声明被放行**) | web_engine 权限 38→8 条 trim,固化 `scripts/web-engine-permissions.trim` + build-ohos.sh 构建前重放(sync-engine 还原后自动恢复 trim) |
| T2 | **multiAppMode 不被承认** | `launchType:"specified"` 启动被拒:hilog `[ability_util.h340] Not support multi-instance` → StartAbilityError:-1(API 26 普通应用无"应用多开"资质) | 参考 wineohos 实证:**删 multiAppMode,launchType 改 `multiton`**(标准 ability 多实例) |
| T3 | 隐式启动匹配失败 | `aa start -b <bundle>` 报 2097199(implicit start;skills 匹配不上) | 显式 `-a EntryAbility` 启动成功;**桌面图标点击是否正常待用户确认**(走 home action 语义,待验),M1 修 skills |
| T4 | trim 检测特征踩坑 | 首版脚本用裸权限名 `ACCESS_BIOMETRIC` 检测原始版,撞上 trim 注释里的已删权限名,误报"重放失败" | 改用带引号完整声明串 `"ohos.permission.ACCESS_BIOMETRIC"` 检测 |

### 10.3 权限最终态(8 条)与 M1 ACL 申请清单

保留:kernel.ALLOW_WRITABLE_CODE_MEMORY(✅ 放行)、INTERNET、GET_NETWORK_INFO、RUNNING_LOCK、PREPARE_APP_TERMINATE、FILE_ACCESS_PERSIST、GET_FILE_ICON、PRINT。
**M1 ACL 申请清单**(真机实测被拒,申请后加回):READ_PASTEBOARD(剪贴板读取,办公核心)、READ_WRITE_{DOWNLOAD,DOCUMENTS,DESKTOP}_DIRECTORY(三目录直读,当前走 picker)。

### 10.4 人工观察项(✅ 用户已确认,2026-09-20)

- 系统三键:frameless 无三键——符合官方已知行为 ✅;
- 托盘图标、中文 IME 输入、中文字体渲染——**全部符合,已勾选** ✅。
- (POC 自检 app 的观察结论;GenOffice 本体的同项人工验证在 G4 逐模块验收中复确认。)

**要素清单调研完成(2026-09-19)**:`docs/ELECTRON_OHOS_CHECKLIST.md` v2 定稿——
- **[官]** openharmony-sig/electron 官方指导项目(克隆 `.temp/ohos-sig-electron`):13 件套产物清单、ACL 权限全集、托盘强绑定窗口、首窗口 metadata、HNP 方案、坚盾模式禁 JIT/wasm、`@electron-ohos/electron-builder`、1294 API 支持矩阵交叉验证(printToPDF/WebContentsView/protocol/dialog ✅;requestSingleInstanceLock/second-instance/setTitleBarOverlay ❌→shim 打桩);
- **[实]** hos_vscodium 逐文件逆向(125 工具调用,含 so 字符串验证):collectAllLibs 语义、arm64-v8a→运行期 `/data/storage/el1/bundle/libs/arm64` 路径规则、CustomChildProcess.toString() 注册机制(白屏最易漏点)、kAbilityMap 按名 startAbility、dev_config.json 硬编码位置(9333 e2e 通道)、PrintAdapter TODO、GenOffice 筛除项(bash/zsh/rg、.node 别名、napi-dyn)。
- 新风险入册:坚盾守护模式下 wasm 全禁(pdfium 三件套失效,M1 需检测降级)。

---

## 11. M1 主体进壳工程记录(2026-09-20,G0-G3 首亮成功)

**里程碑:GenOffice(electron@37 分支)真实构建产物已装入 HAP 并在真机完整点亮**——Home 页全中文渲染、六模块 renderer(Sheets 实证 Univer)在线、9333 CDP 全程可用、6 进程树稳定。

### 11.1 G0:构建源固化(.temp/genoffice)

- 开 `ohos/electron37` 分支:pin electron 37.2.0(7 个 apps package.json + 根 package.json + lock,共 9 文件);pin diff 固化 `scripts/patches/genoffice-e37-pin.patch`(`git apply --check` 于干净 main 通过);分支纪律=只 cherry-pick 不 merge;
- `npm ci` 踩坑(重现):electron postinstall 直连 GitHub 超时 → 绕法 = `npm ci --ignore-scripts` + `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ node node_modules/electron/install.js`;
- build 前置:cargo 须在 PATH(`~/.cargo/bin`——sheets 的 `native:build` 会调,缺则 code 127);
- `npm run build:all` 全绿(顺序 docs→sheets→slides→pdf→markdown→html→cli→shell)。产物实测:docs 27M / sheets 39M / slides 19M / pdf 9.6M / markdown 12M / html 8.5M / shell 19M。

### 11.2 G1:产物管线(`scripts/build-genoffice.sh`)

- 布局(与 resourcesPath 读取点对齐):`resfile/resources/{app(out/main+chunks 菜单PNG+preload×3+renderer), modules/<m>/{preload,renderer}, wasm/{pdfium,hb-subset}.wasm}`;
- 死重裁剪:modules/*/out/main(standalone bundle,28.6M)、cli/(40M)、gsk/ 不装(M3);**组装实测 109M**(app 19 + modules 85 + wasm 5.1,与勘探账表 110M 吻合);
- 断言:main 字段 / bundle>5MB / 六模块 preload+renderer / 死重已裁 / wasm 魔数 `\0asm` / 无 symlink / 无 node_modules 无 .ts / 体积 60~150M 区间;
- 踩坑:harfbuzzjs ≥1.x 源文件名 `harfbuzz-subset.wasm`,packaged 契约读 `hb-subset.wasm`(wasm-path.ts:37)→ 拷贝时改名;
- `--selfcheck` A/B 排障通道:一键回 POC 自检已验证态(自检 app 源迁入 `scripts/selfcheck-app/`);旧 build-app.sh 退役。

### 11.3 G2:main-shim v6(`scripts/shim/main-shim.mjs`)

最终桩清单(顺序铁律:**全部在加载 out/main/index.js 之前**,bundle 顶层求值 resourcesPath/isPackaged):
`platform='linux'` → `title 打桩` → `resourcesPath(天然正确即跳过)` → `HOME/XDG/TMPDIR+chdir(el2)` → `disable-renderer-sandbox` → `isPackaged 钉 true` → `documents 可写探测+降级 el2`(default-save-dir throw 点)→ `单实例恒 true` → `powerMonitor 吞异常` → `WCO 三 API` → `sidecar spawn 重映射(libs/arm64)` → `GO_SHIM_TRAY 预案` → `uncaught 先行` → `createRequire 加载 CJS bundle`。

**两个首亮实测修正(推翻勘探假设)**:
- `process.resourcesPath` fork 默认值**天然正确** = `/data/storage/el1/bundle/entry/resources/resfile/resources`(正是组装目录)——桩改为"已对即跳过";对该属性 defineProperty 疑似触发 native 异常,勿轻碰;
- shim 前奏保持最小(仅 import fs/path):顶部 import node:url/node:module + 探针组合曾伴随 native 退出(未定论因果,最小化后消失)——排障期任何新桩回加都应逐桩打点。

### 11.4 G3:首亮排障实录(三个真凶,均已固化进脚本注释)

| # | 真凶 | 机制 | 修复 |
|---|---|---|---|
| 1 | **CJS/ESM 之坑** | `out/main/index.js` 是 electron-vite 产 **CJS bundle**;组装的 package.json 带 `"type":"module"` → ESM 语境解析 → `ReferenceError: exports is not defined in ES module scope` → shim catch 后主动 quit(表象="The browser process has exited") | package.json 去 type:module(.mjs 后缀天然 ESM 不受影响)+ bundle 经 `createRequire` 加载 |
| 2 | **console 缓冲假象** | v1/v2 hilog 打点显示"死在 platform 桩",实为进程退出时 console 缓冲未 flush 的错觉,误导二分方向 | uncaughtException handler 先行 + **文件日志为准**(shim-log 双写 el2 文件 + console);真死点靠 v3 零桩直载实锤 |
| 3 | **断言 SIGPIPE 误报** | `echo 大清单 \| grep -q`(命中即退)× `set -o pipefail` → 清单大(数百行)后随机误报"缺关键件"(每轮挂不同文件) | `unzip -l` 落盘后 grep 文件,无管道 |

### 11.5 首亮结果(G4-0 提前通过)

- HAP **327,739,021 bytes / 670 files**(mode=genoffice,31 件关键件断言全过);
- 进程树 6 进程(主 + GPU + renderer×N)稳定;CDP `/json/list` 双 target;
- Home(file://):`.home-hero` ✓ + `.quick-card`×7 ✓ + 全中文("晚上好。准备好开始了吗?");截图 `docs/appendix/m1-screenshots/g4-0-home.png`;
- Sheets(genoffice-app://sheets):Univer 容器 + 中文工具栏完整("开始/插入/页面布局/公式/数据/审阅/视图 + Genspark AI");
- 排障决策表七条未全用上——真凶 #1 不在任何预判里(CJS/ESM 形态问题),**零桩直载 + uncaught 同步落盘**的二分法是破局关键,已沉淀为标准动作。

### 11.6 G4 排障实录(2026-09-21,两坑;shim v5/v6)

真机人工操作发现、CDP 与 `uitest uiInput`(系统级输入注入)双轨定位:

| # | 症状 | 真凶 | 定位关键 | 修复(shim 桩) |
|---|---|---|---|---|
| 4 | **输入死区**:docs 打开后 ribbon"插入~视图"选项卡触屏/鼠标点不动;CDP 合成输入(mouse/touch)全部正常 | **fork 上 hidden 的 WebContentsView 仍参与命中测试拦截输入**。shell 有 spare sheets view 常驻 hidden(tab-manager `scheduleSpareSheetsView`,且每开一个 sheets tab 3s 后重建);切走的 tab 也 hidden;且 `activateTab` 只 `setBounds` active view,**非 active view 的 bounds 冻结在创建时刻** | ①uitest 点文件按钮 ✓ 点插入~视图 ✗(CDP 全 ✓)→ 系统输入专属;②三个 view 挂 pointerdown 监听:活区事件正确抵达(clientX 映射无损),死区事件**凭空消失**;③`dumpLayout` 控件树坐标正常(渲染完好,非 UI 问题);④注意 CDP `Input.*` 走 Chromium 内部**不代表**真实输入链路,排障必须用 uitest/hidumper 级证据 | **桩⑬ parking**:1s 周期把 `getVisible()===false` 的 view `setBounds` 移出屏幕(-30000);activateTab 恢复时会重设 bounds 不冲突。真机验证:插入/审阅/开始/视图 uitest 点击全部切换 ✓ |
| 5 | **剪贴板反复弹窗**:打开 pptx 反复弹"无法访问系统剪贴板" | slides renderer 在 **mount+每次窗口 focus** 时 `clipboardProbe` → 主进程 `clipboard.availableFormats()/readText()` → fork 走 `@ohos.pasteboard`,READ_PASTEBOARD 未授权(ACL trim)触发**系统提示弹窗**;弹窗关闭→焦点回归→再 probe→**死循环**(非定时轮询,focus 驱动) | 文案不在任何 i18n(系统级);slides 源码仅 probe 一处主动读剪贴板;READ_PASTEBOARD 在 M1 ACL 裁剪清单内(M1_ACCEPTANCE §4.2) | **桩⑭ 读侧静默**:`availableFormats/readText/readImage/readBuffer/...` 返回空(与 ACL 裁剪后降级语义一致,本就读不到内容),`writeText` 保留。真机验证:开 pptx + 6 轮 tab 切换(focus 反复触发 probe)零弹窗 |

**方法论沉淀**:renderer 内 DOM 层一切正常时,用 **CDP 合成输入与系统输入(uitest)的差异**切分问题域;`hidumper -s WindowManagerService -a '-a'`(窗口树/坐标)、`uitest dumpLayout`(控件树+bounds)是真机 UI 排障的标准探针。

### 11.7 剩余

- **G4** 逐模块操作验收:七级表见 `docs/M1_ACCEPTANCE.md`(0 已过);
- **G5** e2e smoke 七用例:`scripts/e2e/ohos-smoke.mjs` 就位(ws 依赖已入正式仓);
- **G6** 毁灭性重建演练(rm web_engine+oh_modules+resfile/resources+build-profile → 三脚本全绿);
- ACL 权限:ALLOW_WRITABLE_CODE_MEMORY 已有;其余避开并登记(`docs/M1_ACCEPTANCE.md` §4),M2 申请。
