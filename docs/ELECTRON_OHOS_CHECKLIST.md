# Electron on OHOS 基本要素清单(ELECTRON_OHOS_CHECKLIST)

> 状态:官方侧 + 真机实证 + 首亮实测修正的要素清单
> 目的:按装载链分层列出 Electron-on-OHOS 应用的必需与易漏要素,每项标注 **必需性 / 位置 / 内容要点 / 缺失症状**。
> 来源:
> - **[官]** openharmony-sig/electron 官方鸿蒙化指导项目(克隆于 `.temp/ohos-sig-electron`)
> - **[实]** 引擎集成参考源的真机实证(`.temp/engine-ref`)
> - **[推]** 依据机制推断,未逐条实测

---

## 0. 两条装载体系(先读,勿混)

| 体系 | 装载物 | 签名/校验机制 | 对应权限 |
|---|---|---|---|
| **HAP so 体系** | `libs/arm64-v8a/*.so`(libelectron.so、libadapter.so、libffmpeg.so、libc++_shared.so、各 .so 别名) | 安装时 HAP 整体签名,XPM 校验 .so | 无需额外权限 |
| **可执行二进制体系** | 独立可执行文件(`electron` 启动器、`xlsx-sidecar` 等) | 两种方案二选一:①`module.json5` 的 `executableBinaryPaths` 注册(hos_vscodium 实证路线,**GenOffice 采用**)②HNP 包(官方指导项目路线) | HNP 无需 ACL;**未注册/未签名 → XPM 内核拦截,exec 直接失败** |

**[实] 路径规则(易错)**:源码布局是 `libs/arm64-v8a/`,但安装后运行期落盘路径是 `/data/storage/el1/bundle/libs/arm64/`(**无 `-v8a` 后缀**)——executableBinaryPaths 注册、dev_config.json 位置、spawn 绝对路径都按运行期路径写。

**[官] XPM 背景**(HNP 指南原文):PC 25 镜像及以后,应用可执行二进制在**内核层**被 XPM 管控,未签名二进制被拦截,报错形如 `get signature info failed, code_type: ELF`。调试可关:`echo 0 > /proc/sys/kernel/xpm/xpm_mode`(root,仅调试)。

---

## 1. 二进制/运行时层(web_engine HAR 内容物)

编译产物清单(官方 copy.sh + 实测补充,**一件都不能少**):

| # | 文件 | 必需性 | 位置 | 缺失症状[推] |
|---|---|---|---|---|
| 1 | `libelectron.so`(170MB,Chromium+Node) | **必需** | `libs/arm64-v8a/` | HAP 装不上/起不来 |
| 2 | `libadapter.so` | **必需** | `libs/arm64-v8a/` | XComponent(libraryname="adapter")找不到库,白屏 |
| 3 | `libffmpeg.so` | **必需**(音视频编解码) | `libs/arm64-v8a/` | H.264/AAC 等媒体不可用 |
| 4 | `libc++_shared.so` | **必需** | `libs/arm64-v8a/`(从 NDK `native/llvm/lib/aarch64-linux-ohos` 取) | C++ 运行时缺失,dlopen 失败 |
| 5 | `electron`(可执行启动器) | **必需**(appspawn fork 的目标) | `libs/arm64-v8a/` + `executableBinaryPaths` 注册 | runBrowser 后进程起不来 |
| 6 | `icudtl.dat` | **必需**(ICU 国际化数据) | `resfile/` | 启动即崩(Unicode 初始化) |
| 7 | `v8_context_snapshot.bin` | **必需**(V8 启动快照) | `resfile/` | V8 上下文创建失败 |
| 7b | `snapshot_blob.bin` | **必需**(Node 快照) | `resfile/` | Node 侧初始化失败 |
| 8 | `resources.pak` | **必需**(Chromium 资源) | `resfile/` | 内置组件/字符串缺失 |
| 9 | `chrome_100_percent.pak` | **必需**(1x 缩放资源) | `resfile/` | UI 资源缺失 |
| 10 | `chrome_200_percent.pak` | **按需**(2x 缩放,PC 建议) | `resfile/` | 高 DPI 下 UI 资源退化 |
| 11 | `locales/zh-CN.pak` + `locales/en-US.pak` | **按需**(按应用语言面裁剪) | `resfile/locales/` | 对应语言 Chromium UI 回退英文 |
| 12 | `.so 别名模块`(VSCodium 的 napi-dyn 转发层等) | **按需**(GenOffice 零 napi,预计不需要) | `libs/arm64-v8a/` | — |
| 13 | `resfile/resources/app/`(应用 JS 产物) | **必需** | `resfile/resources/app/` | ElectronMain 找不到 package.json main |

---

## 2. HAP 工程层(module.json5 / 工程配置)

| 要素 | 必需性 | 位置 | 内容要点 | 缺失症状 |
|---|---|---|---|---|
| XComponent `libraryname="adapter"` | **必需** | WebWindow.ets(或等价组件) | XComponent 装载 libadapter.so 的入口 | 窗口白屏,libadapter 未加载 |
| `nativeContext.runBrowser(argv)` 调用链 | **必需** | XComponent onLoad | 触发 appspawn fork `electron` | 进程树不出现 electron |
| `--bundle-installation-dir=` 参数 | **必需** | runBrowser argv | 指向 `getContext().resourceDir`,Electron 靠它定位 resfile | Electron 找不到资源目录,启动失败 |
| `executableBinaryPaths` | **必需**(可执行体系①) | module.json5 module 级 | 注册 `libs/arm64-v8a/{electron,node,xlsx-sidecar}` | **XPM 拦截:exec 报 signature info failed** |
| deviceTypes | **必需** | module.json5 | `["tablet","2in1"]`(fork web_engine 支持面;无 phone) | 装不上目标设备 |
| 权限声明 | **必需** | module.json5 `requestPermissions` | 见 §4 | 安装/运行时报权限缺失 |
| 首窗口尺寸 | 按需 | module.json5 abilities[].metadata | `ohos.ability.window.{width,height,left,top}`(left/top 可 `center`) | 首窗口尺寸不可控(默认值) |
| `launchType` | **重要** | module.json5 abilities[] | 单/多实例语义:EntryAbility 用 `singleton`(应用本身按单实例设计,热启动走 onNewWant);StatelessAbility 等仍为 `multiton` | 与 JS 侧单实例逻辑不一致 |
| `multiAppMode` 配置 | **不用则全删** | AppScope/app.json5 | API 26 上 `specified` 启动被系统拒绝(`Not support multi-instance`),该声明不被承认,**所以本工程不声明它** | 声明了反而**上架审核被拒** |
| `nativeLib.collectAllLibs: true` | **必须** | **entry** 的 `build-profile.json5` buildOptionSet(debug+release 都要) | 把依赖 HAR(web_engine)`libs/arm64-v8a` 的全部 so 收进 entry HAP(entry 代码不直接链接也要)——**[实]漏掉 = HAP 里没有 libelectron/libadapter/libffmpeg,安装成功但 XComponent load "adapter" 失败 → 白屏** |
| `extractNativeLibs: true` | **必须** | entry module.json5 | 安装时把 so 解出为真实文件到 `/data/storage/el1/bundle/libs/arm64/`(dlopen 绝对路径、exec、XPM 校验都依赖) | [实]`/data/storage/el1/bundle/libs/arm64/*` 不存在 → dlopen 失败 → 白屏/闪退 |
| `compressNativeLibs: false` | **必须** | entry module.json5 | HAP 内 so 不压缩(保证 mmap + 省安装解压) | 安装缓慢/装载异常 |
| ability 命名约束 | **必须** | entry module.json5 abilities[] | **[实]引擎 kAbilityMap 按 AbilityType 名字 startAbility:必须叫 `EntryAbility` / `StatelessAbility` / `TaskManagerAbility`**(删改需同步 fork CommonInterface) | 新窗口/任务管理静默失败 |
| pages 全注册 + main_pages.json | **必须** | entry pages/ + main_pages.json | **[实]8 个宿主页都要在 main_pages.json;`pages/Index` 即使 Electron 全屏接管也必须存在——XComponent/runBrowser 挂在它上面,且承担 CustomChildProcess 注册时机** | loadContent 失败回调 err → 纯白窗无崩溃 |
| CustomChildProcess.toString() 注册 | **必须(最易漏)** | entry pages/Index.ets / NodeHandleWindow.ets 顶层 | **[实]页面模块顶层裸调用 `CustomChildProcess.toString()`**,强制模块求值保引用,使 `childProcessManager.startChildProcess('./ets/process/CustomChildProcess.ets', APP_SPAWN_FORK)` 找到类;防 release 摇树删除 | **首窗口能起、renderer fork 失败 → 白屏**,日志 `startChildProcess failed` |
| oh-package 依赖链 | **必须** | 根/electron/web_engine 的 oh-package.json5 | electron `dependencies:{web_engine:'file:../web_engine'}`;web_engine 依赖 inversify+reflect-metadata(DI 容器)+libadapter.so 类型包 | import 'web_engine' 编译失败 / DI 注入抛错 |

---

## 3. 应用 JS 层(resfile/resources/app/)

| 要素 | 必需性 | 位置 | 内容要点 | 缺失症状 |
|---|---|---|---|---|
| `package.json` 的 `main` | **必需** | `resources/app/package.json` | ElectronMain 载入入口(GenOffice:main-shim.mjs);**必须是解包目录,不是 asar**([实]fork 对 resfile 下 asar 支持差) | 启动失败:找不到 main |
| main-shim 六件事 | **必需(每件独立致命)** | main-shim.mjs | **[实]VSCodium 实证版**:① `process.platform→'linux'` ② `process.title` getter/setter 打桩(OHOS 无 setproctitle) ③ HOME/XDG/TMPDIR/SHELL/PATH 环境改造 + argv.json(含 `disable-chromium-sandbox`)+ chdir(el2/files,子进程只能 chdir 到 /data/storage 下) ④ powerMonitor 订阅吞异常(fork 缺 setListeningForShutdown,订阅即 abort) ⑤ WCO 三 API 打桩(setTitleBarOverlay/setWindowButtonVisibility/setWindowButtonPosition)+ 窗口控制 ipcMain ⑥ 主进程原生模块预加载(**VM 销毁后首次 dlopen .node 即 ecma_vm destructed abort**;GenOffice 零 napi 预计不需要,真机确认) + shim-log 落盘;**本工程实装版(17 个编号桩,含 isPackaged/documents 降级/sidecar spawn 重映射)以 `scripts/shim/main-shim.mjs` 为准,清单见 `SHIM_INTERNALS.md`** | ①缺→启动即静默退出;③缺 disable-chromium-sandbox→沙箱初始化失败白屏;④缺→订阅 powerMonitor 时 native abort;⑥缺→"打开某功能几秒后闪退" |
| shim-log.txt | **必需(排障命脉)** | main-shim 写 `/data/storage/el2/base/files/shim-log.txt` | 六件事逐步打点 + out/main.js loaded/FAILED | 启动失败完全黑盒 |
| `--user-data-dir` | **必需**(默认已合理) | fork CommandLineAdapter 默认 argv | `/data/storage/el2/base/files/`(el2 用户数据区);**[实]默认 argv 全套:`--use-gl=egl --enable-features=UseOzonePlatform --ozone-platform=ohos --enable-logging --no-zygote --force-renderer-accessibility=basic --disable-gpu-watchdog --disable-features=EnableDrDc`** | `--ozone-platform=ohos` 缺→Surface 对接失败黑屏;user-data-dir 缺→写不出沙箱即崩 |
| `--bundle-installation-dir` | **必需** | WebWindow XComponent onLoad 注入 | 值=`getContext().resourceDir`(HAR resfile 合并后的运行期目录),pak/icudtl/snapshot/locales 全靠它定位 | [实]libelectron 资源初始化失败,启动崩溃 |
| 托盘 Tray | **条件必需** | 应用 main | **[官]OH 限制:窗口显示/隐藏与托盘强绑定,启动前需先建 Tray**;否则改 `AppWindowAdapter.ets` 注释 `processMode`/`startupVisibility` | 窗口 hide/show 行为异常/不显示 |
| 命令行参数注入 | 调试期必需 | `web_engine/.../CommandLineAdapter.ets` | appendSwitch 入口(官方 README 写 WebWindow.ets/CommandLineAdapter 两处,以 fork 实际代码为准) | 参数不生效 |
| 窗口三键(关闭/最小化/最大化) | **注意** | entry EntryAbility | 方案是**保留系统三键 + 隐藏标题栏**:`setWindowDecorVisible(false)` + `setWindowDecorHeight(40)`。注意 Chromium 创建平台窗口时会重置装饰,须在其后重设(见 `PORT_DESIGN.md` §6.1) | 无边框窗口没有鼠标可达的关闭入口(WCO 打桩的根因) |
| 编译产物放置 | **必需** | `resources/app/` | **鸿蒙无编译环境,必须放编译好的 JS 产物**(不能放 TS);[实]node_modules 保留解包目录 + 放一个 28 字节空壳 `node_modules.asar`(`{"files":{}}`)防加载器误判 | — |
| **主 bundle 模块形态(M1 实测)** | **必需** | app/package.json | **[M1]electron-vite 主 bundle 是 CJS——app package.json 禁带 `"type":"module"`**(否则 ESM 语境解析 → `exports is not defined` → 启动即退);shim 加载 bundle 用 **createRequire** 勿用 dynamic import;.mjs 后缀的 shim 自身不受包级 type 影响 | 启动即退,日志 "The browser process has exited"(参考 `PITFALLS.md`「主进程 bundle 被当成 ESM 解析」) |
| shim 排障法(M1 沉淀) | **调试期必需** | main-shim.mjs | **uncaughtException handler 先行 + 文件日志为准(shim-log 双写 el2 文件+console)**——退出时 console 缓冲丢失会造成"死在某桩"假象误导二分;卡死时零桩直载 bundle 二分定位;`process.resourcesPath` fork 天然正确勿 defineProperty(native 异常风险) | 打点"死在桩上"多为假象,真凶在更后面 |

---

## 4. 签名/权限层

### 4.1 签名

- 调试证书与 bundleName 强绑定,现用 `app.fuqidian.sotaoffice` 名下的 SotaOffice 档(ACL 五件齐);签名材料从 `scripts/.signing.snippet` 注入,缺了自动降级产 unsigned HAP。详见 `PERMISSIONS_ACL.md`;
- **[官] 未申请到 ACL 证书时,可暂时注释 ACL 权限再签名**(HAP 能装,功能受限)。

### 4.2 权限清单

当前声明 **12 条**(`requestPermissions`)+ 2 条 `definePermissions`,唯一事实源是 `web_engine/src/main/module.json5`。**完整清单与申请状态以 `PERMISSIONS_ACL.md` 为准**,本节只列装载侧的要点。

| 层 | 权限 | 用途 |
|---|---|---|
| **Electron 运行时** | kernel ACL `ALLOW_WRITABLE_CODE_MEMORY` | V8 JIT 的 W^X 内存页(唯一 kernel ACL) |
| **system_grant** | `INTERNET` / `GET_NETWORK_INFO` / `RUNNING_LOCK` / `PREPARE_APP_TERMINATE` / `FILE_ACCESS_PERSIST` / `GET_FILE_ICON` / `PRINT` | 网络 / 后台长转换防休眠 / 退出前清理(杀 sidecar) / Uri 持久化 / Home 图标 / 打印 |
| **ACL(user_grant)** | `READ_PASTEBOARD` + `READ_WRITE_{DOCUMENTS,DOWNLOAD,DESKTOP}_DIRECTORY` | 剪贴板读取 + 三目录直读 |

> **user_grant 的关键**:声明 + profile 覆盖只给"申请资格",还须在窗口就绪后走 `requestPermissionsFromUser`。
> 只声明不申请时,写用户目录会 EPERM;**没授权时渲染进程根本不会创建,应用走 `window-all-closed` 退出**
> (退出码 0、无异常,看着像崩溃)。`build-ohos.sh` 会校验必需声明齐全并拦截未获批权限出现。

**永久裁剪(不申请)**:`CUSTOM_SANDBOX` / `ALLOW_EXTERNAL_NATIVE_CODE` / `WEB_NATIVE_MESSAGING` / `READ_WRITE_USER_FILE` / `ACCESS_USER_FULL_DISK`,以及浮窗·置顶·隐私窗·cert·传感器·相机·定位·蓝牙全家。

### 4.3 上架注意

- **[官] 上架 PC 市场若报权限错误**:检查是否含仅 2in1 设备的权限;方案=把仅 2in1 权限从 web_engine 模块移到 pc_entry 模块,或删掉 pad_entry;
- 上架需 electron-builder-ohos 或 DevEco 签名产物(`hdc app install xxx-signed.hap` 安装)。

---

## 5. API 支持面交叉验证(官方 1294 API 矩阵 × GenOffice 使用面)

> 数据源:官方 docs/api/index.md(66 模块 1294 API:支持 998 / 不支持 296)。
> 官方矩阵与 GenOffice 实际使用面的逐条核对。

### 5.1 GenOffice 关键依赖 → 全部支持 ✅

| API | 状态 |
|---|---|
| `ipcMain.handle` / `handleOnce` | ✅ |
| `protocol.handle` / `registerSchemesAsPrivileged` / `registerFileProtocol` | ✅(4 scheme 可用) |
| `dialog.showOpenDialog/SaveDialog`(+Sync) | ✅ |
| `contents.printToPDF` | ✅(真机已验证,M1 用例 `docs-export-pdf`) |
| `new WebContentsView` + `view.webContents` | ✅ |
| `utilityProcess.fork` | ✅ |
| `win.capturePage` | ✅ |
| `Menu.buildFromTemplate` | ✅ |
| clipboard 核心(`readText/writeText/readImage/writeImage/read/write/readBuffer/writeBuffer/has/availableFormats`) | ✅ |
| `app.getPath` | ✅ |
| `--remote-debugging-port` / `--inspect` | ✅ 无差异(e2e 通道靠它) |

### 5.2 不支持 → GenOffice 实际使用点与对策

| API | 状态 | GenOffice 使用点 | 对策 |
|---|---|---|---|
| `app.requestSingleInstanceLock` + `second-instance` | ❌ | shell/docs/slides 主进程 + cli open(4 处) | **main-shim 打桩:恒返回 true**(OHOS 侧单实例由 module.json5 `launchType` 管;`second-instance` 用 deeplink/module.json5 skills 替代路由) |
| `win.setTitleBarOverlay`(WCO 动态样式) | ❌ | shell/docs/slides 主进程(titleBarOverlay) | 样式打桩 no-op;窗口按钮改用系统装饰方案,见 `PORT_DESIGN.md` §6.1 |
| `app.setAsDefaultProtocolClient` | ❌ | (文件关联/deeplink 相关) | 用 module.json5 skills(uris.scheme)声明;文件打开走 **6 类 UTD FileOpen** + onNewWant → 信号文件 → control.sock,见 `PORT_DESIGN.md` §6.3 |
| 系统打印对话框(PrintAdapter) | ⚠️ **半成品** | web_engine PrintAdapter.ets:39 `TODO: need adapter print file` | **[实]fork 的系统打印适配有 TODO 未完成**:`webContents.print()` 回调正常触发但恒失败,降级方案(拦截 print 改走 `printToPDF`)见 `OPEN_ITEMS.md`。`webContents.printToPDF`(纯 Chromium 管线)不受影响 | 点"打印"静默失败(导出 PDF 正常) |
| `app.setAppUserModelId` | ❌ | (Windows 任务栏专用) | 无影响,shim no-op |
| `clipboard.clear/readRTF/writeRTF/readBookmark/writeBookmark/readFindText/writeFindText` | ❌ | **零使用** | 无影响 |
| `--disable-renderer-backgrounding` | ❌ | (后台渲染优先级) | OHOS 强制能效模式,不可绕;长转换用 RUNNING_LOCK |
| `--host-rules` | 已弃用 | — | 用 `--host-resolver-rules`(支持) |

### 5.3 fork 新增 OHOS 专属 API(可选加分项)

- `BrowserWindow` 构造参数 `windowInfo: { type: 'mainWindow' | 'subWindow' | 'floatWindow' }`(OHOS 窗口类型)
- `systemPreferences.requestSystemPermission(permission)`:`location/camera/microphone/screen-capture/user-download-dir/user-desktop-dir/user-document-dir/bluetooth/pasteboard`
- `systemPreferences.requestDirectoryPermission(path)`:批量请求三目录;`fileAccessPersist(paths)`:持久化授权
- `systemPreferences.callArkTSFunction(fn, returnType, params)`:JS→ArkTS 通道(AKI 桥;**ArkTS 侧必须同步返回**,支持 6 种返回类型)——M2/M3 接 OHOS 原生能力的扩展点

---

## 6. 子进程/可执行文件调用

| 方案 | 机制 | 优点 | 缺点 | 采用 |
|---|---|---|---|---|
| ① `executableBinaryPaths` | module.json5 声明,安装时系统对二进制签名 | 声明式、无构建链 hack、**hos_vscodium 真机实证** | API 20+ | **✅ 主路线** |
| ② HNP 包 | `hnp/hnp.json` + hnpcli 打包 + module.json5 `hnpPackages` + **手改 DevEco hvigor 插件 JS 两处**(packing-tool-options.js / base-pack-hap-task.js) | 官方指导项目路线,环境变量自动入 PATH(HNP_PUBLIC_HOME/HNP_PRIVATE_HOME),软链接可执行名 | 需 hack DevEco 打包流水线,版本升级易碎 | 备选 |
| ③ 关 XPM(仅调试) | `echo 0 > /proc/sys/kernel/xpm/xpm_mode` | 零配置 | root + 全系统安全面下降,**不可用于交付** | 仅排障对照 |

fork/`ELECTRON_RUN_AS_NODE`(官方:fork 需 electron 二进制可执行,即方案①或②先就位)、`spawn`(xlsx-sidecar)同源:GenOffice 的 sidecar 放 `entry/libs/arm64-v8a/`(运行期是 `libs/arm64/`)+ `executableBinaryPaths` 注册。它是交叉编译出的 aarch64-ohos **动态链接** ELF(`interpreter /lib/ld-musl-aarch64.so.1`);shim 里 spawn 的 argv[0] 也要按运行期路径重映射。

---

## 7. 调试/运维层

| 要素 | 用法 |
|---|---|
| 渲染进程调试 | `webContents.openDevTools()`(正常可用) |
| 主进程调试 | `--inspect=9229` 加入 vec_args → `hdc fport tcp:9229 tcp:9229` → PC Chrome `chrome://inspect` |
| e2e 通道 | **[实]无需改代码:libadapter.so 硬编码读 `/data/storage/el1/bundle/libs/arm64/dev_config.json`,内容 `{"remote-debugging":true,"remote-debugging-port":9333}` 即开 9333**(文件缺失=关闭,无碍运行;**必须放 entry libs,放 resfile 无效**)→ `hdc fport tcp:9333 tcp:9333` → Playwright connectOverCDP |
| crash-hook | [实]SIGSEGV/ABRT/ILL/BUS/FPE altstack handler 写 `/data/storage/el2/base/files/crash-hook.txt`(寄存器 + 48 帧回溯);源码在参考源 `.temp/engine-ref/native/src/`,**当前决定不搬入**(遇 fork 崩溃无栈时再加) |
| hilog 定位 | 包名搜 `APPSPAWN` 找主进程 pid;`<pid>.+Child process started.+pid` 找子进程(GPU/Renderer/Utility);框架日志三分:Adapter / WebEngine / Chromium;TAG `[WebEngine]`/`WebAbility` |
| 沙箱路径自查 | `nsenter -t <pid> -m sh` 进入进程 mount ns 看真实路径 |
| 用户数据 | `/data/storage/el2/base/files`(系统文件管理器可见) |
| 日志文件 | `--enable-logging=file` + `--log-file=<path>`(未指定 log-file 时默认用户数据目录 electron_debug.log) |
| 崩溃上报 | 需提供日构建版本号(如 20241229.1)或 commit-id + 崩溃堆栈(DevEco 保存按钮) |
| 覆盖安装报 9568332 | [实]先 `hdc shell bm uninstall -n <bundle>` 再装(签名变化时) |

---

## 8. 安全/特殊模式(新发现风险)

**[官] 坚盾守护模式**(系统设置→隐私和安全→坚盾守护模式):
- 全面禁用 JIT(含已获 ACL 权限的应用);
- 暂停 WebAssembly 支持(wasm 依赖 JIT)。

**对本应用的影响**:`pdfium.wasm` / `hb-subset.wasm` 在坚盾模式下**不可用** → PDF 管线整条失效。应对:
1. M1 检测降级路径(检测 wasm 初始化失败 → 提示"坚盾模式下 PDF 功能受限");
2. 长期:评估 pdfium 原生 .so 化(走 HAP so 体系,不受 JIT 限制)——列为 M2 评估项。

---

## 9. 构建链工具(官方推荐,替代手工拷贝)

**`@electron-ohos/electron-builder`**(npm 包,鸿蒙版 electron-builder):

```jsonc
// Electron 工程 package.json
"scripts": { "dist:ohos": "electron-builder-ohos --ohos" },
"build": {
  "ohos": {
    "target": ["hap"],
    "hvigorwPath": "...", "ohpmPath": "...", "sdkPath": "...",
    "ohosHapPath": "<鸿蒙工程路径>",          // web_engine HAR 所在
    "certPath": "debug.cer", "profile": "x.p7b",
    "keyAlias": "...", "keyPassword": "...", "storeFile": "x.p12", "storePassword": "...",
    "requestPermissions": [ ... ],            // 权限同步进 HAP
    "skills": [ ... ]                         // deeplink 配置同步
  }
}
```

**当前用的是手工脚本链**——`scripts/sync-engine.sh` → `build-genoffice.sh` → `build-ohos.sh`,步骤全在仓里、可复现。`electron-builder-ohos` 是官方路线(Electron 工程直出 HAP、权限与 skills 一体化),上架前可评估。

---

## 10. 落地核对单

按失败代价从高到低排序——搭同类工程时按这个顺序核对。**本工程这些项均已落实。**

- [x] **① entry build-profile:`nativeLib.collectAllLibs:true`**(debug+release 两个 buildOptionSet 都要)——漏=白屏
- [x] **② entry module.json5:`executableBinaryPaths`(electron/node/xlsx-sidecar)+ `extractNativeLibs:true` + `compressNativeLibs:false`**
- [x] **③ 权限:kernel.ALLOW_WRITABLE_CODE_MEMORY(签名 profile 必须带)+ 引擎 requestPermissions**
- [x] **④ web_engine HAR:libs 三件套 + resfile 全量资源进 HAP**(collectAllLibs 只管 libs,resfile 靠 HAR 依赖自动合并)
- [x] **⑤ 继承链:MyAbilityStage extends WebAbilityStage + EntryAbility extends WebAbility + CustomChildProcess extends WebChildProcess;pages/Index 顶层 `CustomChildProcess.toString()`**
- [x] **⑥ main_pages.json 页全注册 + ability 命名(EntryAbility/StatelessAbility/TaskManagerAbility)**
- [x] **⑦ resfile/resources/app/:package.json(main=main-shim.mjs;禁带 type:module,见 §3)+ shim 全部桩 + shim-log**
- [ ] ⑧ Tray 或 AppWindowAdapter 注释(二选一,窗口显示策略)——本应用没有 Tray,不打桩
- [x] ⑨ 单实例:`EntryAbility.launchType = "singleton"` + `onNewWant` 热启动链
- [x] ⑩ `dev_config.json` 放 entry libs(9333 e2e 通道)
- [x] ⑪ 签名:`scripts/.signing.snippet` 注入材料 + kernel ACL;覆盖安装报 9568332 先 `bm uninstall`
- [x] ⑫ 崩溃时:hilog 按包名/APPSPAWN 定位 + 坚盾模式确认关闭

---

## 11. GenOffice 适用性筛除(清单中不适用的项)

hos_vscodium 清单中以下要素 **GenOffice 不需要**(零 napi/零 CLI 工具),筛除依据:

| 要素 | VSCodium 用途 | GenOffice 判定 |
|---|---|---|
| `bin/{bash,zsh,rg}` + executableBinaryPaths 注册 | 集成终端/全文搜索 | **不需要**(无终端);未来 MCP/CLI 生态(M3)再补 |
| `.node`→`.so` 别名双胞胎(8 组) | 原生模块过 XPM | **不需要**(零 napi 模块) |
| napi-dyn 转发层(libelectron RTLD_LOCAL dlsym 桥) | 自编 .node 链接 napi 符号 | **不需要**;若 M2 做 pdfium 原生化,重编 .node 时**必须**走此方案(方法描述符 `napi_default_method`) |
| `node` 启动器(ELECTRON_RUN_AS_NODE) | 扩展宿主/utilityProcess | **已采用**,注册在 `libs/arm64-v8a/node`(为 utilityProcess/MCP 生态预留) |
| extensions/ohos-terminal、product.json/policies | VS Code 特有 | 不需要 |
| 蹭系统白名单包名(com.huawei.codearts.agent) | CodeArts 覆盖 | 不适用(用 `app.fuqidian.sotaoffice`) |

沙箱走 `app.commandLine.appendSwitch('disable-renderer-sandbox')`(shim 桩⑤b,须在 app ready 之前),不用 argv.json;
Vulkan SwiftShader ICD 有 json 无 so([实]H12 软渲染缺口)——PC 真机走 egl 正常,若遇 GPU 异常机器注意此缺口。

---

## 附 A:装载链总图([实]hos_vscodium 逆向核实)

```
hvigor 构建
  └─ entry(electron 模块)HAP ← 收录 HAR(web_engine)的 libs(collectAllLibs)+ resfile(依赖合并)
安装期
  ├─ extractNativeLibs → 解出 /data/storage/el1/bundle/libs/arm64/*
  └─ executableBinaryPaths → 注册可执行位(electron 启动器等)
启动期
  AbilityStage(entry 继承 WebAbilityStage)
    └─ initNativeContext(kMainProcess) + inversify 容器 + 38 个 adapter JSBind 注册 + SetContextPaths
  EntryAbility(继承 WebAbility)loadContent pages/Index
    └─ WebWindow 的 XComponent(libraryname="adapter", type=SURFACE) onLoad
        ├─ appendSwitch('bundle-installation-dir', resourceDir)
        └─ runBrowser(vec_args) → 拉起 libelectron.so
            └─ libelectron fork /data/storage/el1/bundle/libs/arm64/electron 启动器
                └─ ElectronMain → 加载 resfile/resources/app/package.json 的 main(main-shim.mjs)
                    └─ shim 六件事 → import out/main.js(GenOffice:shell 主进程 bundle)
renderer 子进程链(每窗口)
  native ChromiumChildProcessStarter.StartChildProcess(JSBind 回调)
    └─ childProcessManager.startChildProcess('./ets/process/CustomChildProcess.ets', APP_SPAWN_FORK)
        └─ CustomChildProcess(pages/Index.ets toString() 保引用)→ getNativeContext(kRenderProcess) → runOtherProcessType
```

## 附 B:web_engine HAR 关键内部件([实],搬用时整体带走、勿单独改)

| 部件 | 行数 | 职责 |
|---|---|---|
| WebAbilityStage(application/) | ~80 | onCreate 异步链:initNativeContext→DI→JSBind(43 adapter)→SetContextPaths;onAcceptWant 多实例 key;onPrepareTermination→kAppQuit |
| WebBaseAbility/WebAbility(ability/) | ~220/~445 | want 参数解析(xcomponentId/hideTitleBar/...);全套窗口回调→nativeContext.OnXxx;onNewWant(file:// 打开);PermissionManager.initPermissions |
| WebChildProcess(process/) | ~18 | 继承 @ohos.app.ability.ChildProcess;onStart→runOtherProcessType(kRenderProcess) |
| WebWindow/WebWindowNode(components/) | ~244/~194 | NodeController+XComponent(SURFACE, libraryname="adapter");**onLoad=引擎真正启动点**;手势/拖放转发 |
| CommandLineAdapter(common/) | ~175 | 单例;默认 argv 全套(见 §3);appendSwitch 注入口 |
| PermissionManagerAdapter(adapter/) | ~388 | 权限名→系统能力映射;requestFullDiskAccessOnce(VSCodium 增) |
| JsBindingUtils(utils/) | ~60 | libadapter.so 的 getNativeContext/SetContextPaths 封装 |
| CommonInterface.ts(interface/) | ~357 | NativeContext 全量签名;kAbilityMap(**引擎按名 startAbility**);ContextType/CommandType 枚举(与 so 二进制耦合,勿改序) |
| 43 adapter + 38 jsbindings | — | 每个 Bind 经 JSBind.bindFunction 交给 C++;漏一个=对应功能静默失效 |
| inversify DI(common/) | — | CommonModule/AdapterModule/GlobalThisHelper.appInit;未初始化 Inject.get 抛错 |

## 附 C:已知隐藏缺口([实],遇症对照)

| # | 缺口 | 症状 |
|---|---|---|
| H4 | `--electron-exec-path-ohos` 开关链路当前无 so 消费方(libelectron 内部硬编码 `/data/storage/el1/bundle/libs/arm64`) | 排障时勿据此误判路径问题 |
| H10 | PrintAdapter TODO 未完成 | 系统打印对话框静默失效(printToPDF 导出不受影响) |
| H11 | checkInstanceLimit 仅日志无逻辑 | 多实例超限不拦截 |
| H12 | Vulkan SwiftShader ICD 有 json 无 so | 需软渲染的机器黑屏(PC 真机走 egl 未见问题) |
| H13 | locales 只带 en-US/zh-CN | 其他系统语言缺 Chromium UI 字符串 |
| H14 | build-variants.sh 引用的 save-signing.sh 仓库中不存在 | 照抄流程会断;GenOffice 不抄此脚本 |
| H15 | ~~user_grant usedScene 用占位 Ability 名~~ | 已修:本工程的 `usedScene.abilities` 统一用 `EntryAbility` |
