# GenOffice → HarmonyOS 移植设计

> 分区：移植方案 | 目标：HarmonyOS PC(2in1) 优先
> 决策与架构看本文；踩坑见 `PITFALLS.md`；能力矩阵与验收见 `ELECTRON_OHOS_CHECKLIST.md`、`M1_ACCEPTANCE.md`；
> 上游应用的源码级分析见 `appendix/`；文档索引见 `README.md`。

## 0. 决策

| # | 决策 | 依据 |
|---|---|---|
| D1 | **路线 A：Electron-on-OHOS**——用 openharmony-sig 维护的 Electron fork（`v37.2.0-openharmony`，Chromium 138 + Node 22.17）当运行时，应用产物原样装入 HAP | GenOffice 是"重 Node 主进程"应用（419 个 `ipcMain.handle` + 4 个自定义 scheme + printToPDF + WebContentsView + 内嵌 HTTP 服务），ArkTS 壳重写是**人年级**成本，换运行时是人月级 |
| D2 | **仅 PC(2in1)**；`deviceTypes` 两处声明均为 `["2in1"]`，**手机、平板均不在支持面** | fork 的窗口层面向大屏（手机不在 fork 支持面）；平板拒装 `executableBinaryPaths` 应用（9568449），HNP 平板又不支持，平板路线关门（详见 PITFALLS「平板装不上」） |
| D3 | **版本策略：应用降级适配 Electron 37**（不去升级 fork 到 43） | 升级 fork 等于自编译 Chromium（>200G 磁盘、>32G 内存） |
| D4 | 发布侧 kernel ACL 目标**仅 1 条**：`kernel.ALLOW_WRITABLE_CODE_MEMORY` | V8 JIT 的 W^X 内存页，是 Electron 运行时的唯一硬需求；场景对口官方定义"自带引擎的即时编译" |
| D5 | `kernel.LOAD_INDEPENDENT_LIBRARY` **不申请** | 它是参考工程内置 CLI 工具（bash/zsh/rg）的需求，不是 Electron 运行时需求——`libelectron.so` 走 HAP 的 so 签名体系装载。将来做 CLI 生态时再评估 |
| D6 | Rust xlsx-sidecar 交叉编译为 aarch64-ohos 可执行文件，走 `executableBinaryPaths` 注册 + spawn，stdio JSON 协议零改动 | 规避独立库装载的权限问题；上游 Windows 版也是独立可执行文件 |
| D7 | 产物可复现纪律：产物不入库、一键重生成脚本、毁灭性重建演练 | 全局构建可复现原则 |

## 1. 背景与对象

**GenOffice**（上游应用，源码在 `thirdparty/genoffice`）：开源 AI Office 套件（Docs/Sheets/Slides/PDF/Markdown/HTML + AI 面板），Electron 43.3 + Node ≥22.12 + npm workspaces monorepo，约 55 万行 TS（渲染层 35.5 万 + 主进程 5.4 万 + 引擎包 14.3 万）。

对移植关键的仓库特征（详见 `appendix/A`）：

- **渲染层 100% 纯 Web**：全仓 renderer `from 'electron'` 零命中，React 19 + DOM + Canvas（TipTap/Univer/Konva/PDF.js/CodeMirror），构建产物是纯静态资源；
- **零 napi/.node 模块**——避开了 fork 已知最深的坑（ObjectWrap 构造崩溃、napi-dyn 转发）；
- 二进制依赖只有三样：xlsx-sidecar（Rust，stdio JSON-lines 子进程）、pdfium/hb-subset wasm（跑在 Node 主进程）、平台 OCR helper（有降级路径）；
- 最大负担：419 个 `ipcMain.handle`、7 组 preload `window.*` API、4 个自定义 scheme、WebContentsView 多标签、printToPDF、菜单、单实例、updater。

## 2. 选型论证

| 维度 | A：Electron-on-OHOS（选定） | B：ArkTS 壳 + ArkWeb |
|---|---|---|
| 主进程 5.4 万行 | 原样跑（Node 22.17 完整运行时） | 419 IPC + 4 scheme + 打印 + 多标签逐个重写 |
| printToPDF / CDP / WebContentsView | fork 内置 | ArkWeb 无对应，另起炉灶 |
| Rust sidecar | 交叉编译 + spawn，协议零改动 | 必须改造 NAPI `.so`，协议重设计 |
| wasm（pdfium 等） | fork 的 Node 主进程原样跑 | ArkTS 无 wasm 引擎，PDF 管线搬家 |
| MCP server / control socket | 原样跑 | 无对应，裁剪 |
| Electron 43→37 | 需清点适配 | 无此问题 |
| kernel ACL | 需 1 条（D4） | 不需要 |
| 工作量 | **人月级** | **人年级** |

判据出处见 `appendix/B`：目标应用若深度依赖 Node 主进程、多进程与 Electron API 面，换运行时反而比重写省。GenOffice 命中该判据的极端形态。

## 3. 目标架构

```
┌─ HarmonyOS HAP(单 entry 模块 + web_engine HAR)───────────────────┐
│  entry 模块(ArkTS,继承 WebAbility/WebAbilityStage,薄壳)         │
│    ├─ executableBinaryPaths: electron / node / xlsx-sidecar      │
│    │    都落在 libs/arm64-v8a/(源布局;运行期是 libs/arm64)      │
│    └─ 文件关联 skills(6 类 UTD,见 §6.3)                          │
│                                                                    │
│  web_engine HAR(适配层已自有化入本仓 git 管理)                    │
│    ├─ libelectron.so (177MB, Chromium 138 + Node 22.17)            │
│    ├─ libadapter.so / libffmpeg.so                                 │
│    └─ resfile: pak / icudtl / snapshot / locales                   │
│                                                                    │
│  resfile/resources/  ← 应用打包产物                                 │
│    ├─ app/   主进程 bundle + main-shim.mjs(兼容层,见 SHIM_INTERNALS)│
│    ├─ modules/<模块>/{preload,renderer}  六个模块各自的静态产物     │
│    └─ wasm/{pdfium,hb-subset}.wasm                                 │
└────────────────────────────────────────────────────────────────────┘
```

**装载链**：`WebAbilityStage → XComponent(libraryname="adapter") 装载 libadapter.so → nativeContext.runBrowser(argv) → appspawn fork electron 启动器 → 链接 libelectron.so → ElectronMain → 载入 resfile/resources/app/package.json 的 main（= main-shim.mjs）`。

**权限声明只有一处**：`web_engine/src/main/module.json5`（随 HAR 合并），entry 模块自身零声明。

## 4. 权限

**两条装载/签名体系的区分（勿混淆，见 D5）**：

- **HAP so 签名体系**：`libs/arm64-v8a/*.so` 安装时注册签名（XPM）——`libelectron`/`libadapter` 等走这条，**不需要 `LOAD_INDEPENDENT_LIBRARY`**；
- **二进制证书体系**：`executableBinaryPaths` 注册的独立可执行文件（electron/node 启动器、xlsx-sidecar）——参考工程因为内置 bash/zsh/rg 才申请那条权限，本项目不带 CLI 工具，不申请。

当前声明共 **12 条**（`requestPermissions`）+ 2 条 `definePermissions`：

| 层 | 权限 | 用途 |
|---|---|---|
| **Electron 运行时** | `kernel.ALLOW_WRITABLE_CODE_MEMORY`（唯一 kernel ACL） | V8 JIT 的 W^X 内存页 |
| | `INTERNET` / `GET_NETWORK_INFO` | AI 与网络功能 |
| **应用集（system_grant）** | `GET_FILE_ICON` / `RUNNING_LOCK` / `PREPARE_APP_TERMINATE` / `FILE_ACCESS_PERSIST` / `PRINT` | Home 图标 / 长转换防休眠 / 退出清理（杀 sidecar）/ 授权持久化 / 打印 |
| **ACL（user_grant，须运行时申请）** | `READ_PASTEBOARD` + `READ_WRITE_{DOCUMENTS,DOWNLOAD,DESKTOP}_DIRECTORY` | 剪贴板读取 + 三目录直读 |
| **显式裁剪，不申请** | `CUSTOM_SANDBOX` / `ALLOW_EXTERNAL_NATIVE_CODE` / `WEB_NATIVE_MESSAGING` / `READ_WRITE_USER_FILE` / `ACCESS_USER_FULL_DISK` / 浮窗·置顶·隐私窗·cert·传感器·相机·定位·蓝牙全家 | 前两条分别由 shim 的 `disable-renderer-sandbox` 与"零 napi 模块"取代；后两条沙箱 + picker 够用；其余是参考工程特有 |

> ACL 的 user_grant 要点：声明 + profile 覆盖只给"申请资格"，还须在窗口就绪后走
> `requestPermissionsFromUser`。只声明不申请时写用户目录会 EPERM。`build-ohos.sh` 会校验
> 必需声明齐全、并拦截未获批权限出现。详见 `PERMISSIONS_ACL.md`。

## 5. 依赖治理

第三方依赖一律以 submodule 引入 `thirdparty/`，固定 tag/commit。

| 依赖 | remote(fork) | 锚点 | 说明 |
|---|---|---|---|
| GenOffice 本体 | `github.com/hackeris/genoffice` | 分支 `ohos/sota-debrand` @ `a1acf05`（**尚无 tag**） | 上游无推送权，故自建 fork。`ohos-v1.0.0` @ `339470d` 是上游基线锚点（上游 316ded6 + 9 文件 electron pin） |
| electron 本体 | `github.com/hackeris/electron` | tag **`ohos-v37.2.0`** @ `3af8ccb` | **引擎件正式来源**；tag = 官方 fork 分支 `electron-v37.2.0-openharmony` HEAD。产物 = fork 构建输出 `src/out/musl_64`，经 `sync-engine.sh` 组装进 `web_engine/` |

**产物来源规范**：任何构建产物，要么是本项目主体代码，要么作为三方依赖在 `thirdparty/` 维护。

| 产物 | 来源 | 归属 |
|---|---|---|
| 应用产物（六模块 renderer/preload、主进程 bundle） | `thirdparty/genoffice` 构建（`npm run build:all`） | 三方依赖 |
| 引擎 so + resfile 资源 | `sync-engine.sh` 组装，默认源 `.temp/engine-ref`（不入库，同构件） | 三方依赖 |
| electron / node 启动器 | 同上 | 三方依赖 |
| `xlsx-sidecar` | `thirdparty/genoffice` 的 Rust 源码交叉编译（`build-genoffice.sh` 自动触发） | 三方依赖 |
| `pdfium.wasm` / `hb-subset.wasm` | `thirdparty/genoffice` 的 npm 依赖产物 | 三方依赖 |
| `libc++_shared.so` | OHOS SDK | 系统工具链 |
| `dev_config.json`（9333 调试开关） | `sync-engine.sh` 生成 | 本项目 |
| web_engine 适配层 / shim / 自检 app | 本仓 git | 本项目 |

**web_engine 适配层已自有化入本仓**（`web_engine/` 的 ets/cpp 适配层、`module.json5`、资源串由 git 管理，只忽略引擎二进制）。`sync-engine.sh` 只组装二进制，**绝不覆盖源码**。

**首次克隆**：`GIT_LFS_SKIP_SMUDGE=1 git submodule update --init`——electron 源仓含 LFS 文件，跳过 smudge 才拿到真实内容（仅构建 electron 本体时需要）。

> `xlsx-sidecar` 交叉编译三坑（cargo 1.98 stable）：①`CC_aarch64_unknown_linux_ohos` 给
> cc crate 编 C 依赖（ironcalc → 旧 zip → bzip2-sys/zstd-sys）；②linker 须显式指 NDK clang，
> 否则系统 ld 报 "Relocations in generic ELF"；③`linker-flavor` 只能用稳定值 `gcc`。

## 6. 关键方案

### 6.1 窗口装饰与系统三键

无边框窗口（`titleBarStyle:hidden`）本该靠 `setTitleBarOverlay` 绘制系统窗口按钮，但 fork 不支持该 API——应用会变成一个没有关闭入口的窗口。

**做法是保留系统装饰、隐藏标题栏**：entry 侧 `setWindowDecorVisible(false)` 让应用内容延展到窗口顶部、三键悬浮右上角；`setWindowDecorHeight(40)` 与 tab 条等高；`setTitleAndDockHoverShown(false,false)` 禁掉 hover 浮出。

**一个必须绕的坑**：web_engine 在 loadContent 回调里设过装饰，但**随后 Chromium 创建平台窗口（`OhosToplevelWindow`）会把它重置**，真机上装饰不出现。ArkTS 侧没有"平台窗口就绪"事件可挂，所以用 800/1500/3000ms **幂等多次重试**覆盖。

### 6.2 三键避让

桌面 Electron 用 CSS 的 `env(titlebar-area-*)` 把窗口按钮区的位置交给应用（WCO），应用据此在右上角留空间。**OHOS 引擎不提供这个变量**，应用算出来的避让宽度恒为 0，标题栏右侧的图标就和系统三键重叠。

**机制补位**：entry 侧监听 `windowTitleButtonRectChange`，把结果落盘 `title-button-rect.json`；shim **桩⑮** 读文件后注入等效 CSS 给 `.tab-bar-caption-spacer`，2 秒重读一次，窗口缩放或按钮显隐变化后能自愈。

> 校验链（真机实测）：系统三键行容器宽 265 物理 = 139.5 CSS px ↔ 注入值 140px；
> 容器左边界 2585 物理 → 相对窗口内容 1220.5 CSS px ↔ CDP 实查 spacer `x:1220`。
> 实现上的一个妥协：那个文件里 `right` 和 `width` 的语义（是否都表示距窗口右缘）不明确，
> 代码取两者中较大的兜底。

### 6.3 文件关联

系统"打开方式"接入，三段链（声明 → 改道 → 消费）：

| 段 | 位置 | 内容 |
|---|---|---|
| 声明 | `entry/src/main/module.json5` 的 skills | 6 条 `{scheme:file, type:<UTD>, linkFeature:FileOpen}`：docx/xlsx/pptx（openxmlformats 系）、pdf（`com.adobe.pdf`）、md（`general.markdown`）、html（`general.html`） |
| 改道 | `EntryAbility.applyOpenDocument` | `want.uri` → `fileUri.FileUri(uri).path` → `cmdArgs`，并**清空 `startUri`**（引擎的 initParameters 会把 want.uri 当 startUri 用于网页应用场景，误留着会导航错） |
| 消费 | 引擎 `CommandLineAdapter.appendArgs` → Chromium argv → 应用 `supportedFileIn(process.argv)` → `openDocumentPath` | 应用侧原生支持 argv 路径入口，**零改上游源码** |

要点：

- `linkFeature:"FileOpen"` 必填且大小写敏感，`scheme` 固定 `file`；
- UTD 名取 `@ohos.data.uniformTypeDescriptor` 预置表——docx/xlsx/pptx 用 openxmlformats 系（`com.microsoft.word.doc` 是旧 doc 格式，别混）；
- 应用侧 `supportedFileIn` 要求**路径真实存在**且扩展名匹配，所以必须转成真实路径而不是 URI。

**热启动**（应用已在运行时再打开一个文件）走这条链，跨三个组件：

```
系统复用 Ability 实例(launchType=singleton,走 onNewWant)
      ↓  EntryAbility 写 open-doc.json(含 path 和 seq)
shim 桩⑰ 每 1.5 秒轮询信号文件
      ↓  读 <userData>/control.json 拿 token 与 socket 端点
连 control.sock,发 {token, request: {cmd:'open', path}}
      ↓
应用自带的 control-server 在现有窗口打开文档
```

任一层改都会断链，这是目前跨组件最多的机制。见 `SHIM_INTERNALS.md` 的「热启动」。

## 7. 风险

| # | 风险 | 状态 |
|---|---|---|
| R3 | 文件系统模型冲突（绝对路径 + 同目录写 + 递归 watch vs 沙箱 + URI） | 沙箱文档目录已收敛；folder-tree/watch 用轮询或裁剪 |
| R4 | fork 引擎缺陷 | 逐项绕行 + CSS 条件样式；见 `UPSTREAM_FEEDBACK.md`（窗口销毁流程 wedge、设备能力上报缺失等） |
| R5 | HAP 体积（libelectron 177MB + 资源） | 当前约 328MB；上架前与商店单包上限核对 |
| R6 | 字体保真（度量读文件 vs Chromium 按名解析的偏差） | 视觉基线未启动；倾向内嵌字体 |
| R7 | 测试网重建（上游 51 个 Playwright-Electron spec 不可用） | 已有 `scripts/e2e/ohos-smoke.mjs` 七用例；引擎包 vitest 单测原样保留 |

## 8. 环境与资产

| 资产 | 位置 | 用途 |
|---|---|---|
| **本工程（正式仓）** | 本仓库根（`.temp/` 只放临时研究素材） | Electron-OHOS 壳工程 + 文档 + 构建链 |
| 应用源码 | `thirdparty/genoffice`（submodule） | 移植对象 |
| 引擎集成参考源 | `.temp/engine-ref`（不入库） | 布局同构的参考 + `sync-engine.sh` 的默认取源地 |
| 官方指导项目克隆 | `.temp/ohos-sig-electron`（不入库） | 官方文档与 API 矩阵来源 |
| OHOS SDK | `<OHOS-SDK>`（6.1.0） | NDK（sysroot/clang）、ets、toolchains（hdc） |
| 签名材料 | 本机签名材料目录（跨项目共享） | 调试证书 |
| Rust OHOS target | `rustup target add aarch64-unknown-linux-ohos` | sidecar 交叉编译 |

## 9. 附录

- `appendix/A-genoffice-architecture.md` —— 上游应用的架构与平台耦合点分析
- `appendix/B-pure-office-methodology.md` —— ArkTS 路线的方法论（B 路线的全套资产与经验）
- `appendix/C-hos-vscodium-runtime.md` —— Electron-OHOS 运行时工程细节（复用清单）
