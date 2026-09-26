# 平板（tablet）支持：证据链与落地形态

结论先行：**引擎层没有硬阻塞，平板与 PC/2in1 跑同一个 HAP（统一包）**。平板装不上只是
`executableBinaryPaths` 一条声明触发的安装门槛，不是引擎能力问题；fork 的多进程链路在平板上
是系统正式支持的能力。统一包移除该声明、可执行位全部退役，xlsx-sidecar 改走系统 Native 子进程。

## 1. 平板拒装的真相

- `executableBinaryPaths` 是官方规格：API 24 起支持，**仅在 PC/2in1 设备上生效**
  （module.json5 标签文档）。声明了它的 HAP，平板在安装期直接拒绝（`9568449` / check bin file failed）。
- 官方替代路线 HNP 平板也不支持（实测）。
- 所以统一包的本质是一句话：**「依赖 exec 的 HAP」改成「不 exec 的 HAP」**。

## 2. 引擎本体为什么能在平板上跑

四条证据，缺一不可，目前全部成立：

1. **JIT 合法**。V8 JIT 的唯一硬需求是 `ohos.permission.kernel.ALLOW_WRITABLE_CODE_MEMORY`，
   官方权限文档明示「**当前仅平板、PC/2in1 设备应用可申请此权限**」——平板在允许面内。
2. **Chromium 子进程不 exec**。fork 的 renderer/GPU/NetworkService 走
   `childProcessManager.startChildProcess(..., APP_SPAWN_FORK)`（`web_engine/.../ProcessAdapter.ets`），
   该接口官方文档明示「**在 Tablet、PC/2in1 中可正常调用**」；libadapter 内的
   `AppSpawnCommunication` 谱系（`BuildCommands`/`PrepareHandleRequest`/
   `HandleRequestAfterChildProcStart`）负责 fork 通道。真机 `ps` 实证：所有子进程的
   进程名都是 `<bundle>:GPU` / `<bundle>:Renderer` / `<bundle>:NetworkService`，
   父进程是系统 spawn 服务，**没有任何一个进程是 exec launcher ELF 拉起的**。
   启动参数默认已带 `--no-zygote`（`CommandLineAdapter.ets`）。
3. **权限面通**。三目录权限的官方口径是「2in1 和平板」均可申请，没有 2in1 专属权限卡住平板
   （上架时按 fork README 的指引，2in1 专属声明仍须移出共享模块，属例行操作）。
4. **其余运行时前提与设备类型无关**：`extractNativeLibs` + dlopen `libelectron.so`、
   XComponent 装载链、resfile 布局，平板上行为一致。

`electron_exec_path_ohos` metadata 指向的 launcher ELF 在真机上没有 exec 消费者（见第 2 条证据），
统一包已不带该声明、不注入该 metadata，launcher ELF 已整体退役。

## 3. 应用侧 fork/exec 清单与处置（已实施）

全量盘点（主进程侧）与落地处置：

| 调用点 | 用途 | 落地处置 |
| --- | --- | --- |
| xlsx-sidecar `spawn`（`apps/sheets/src/main/xlsx-sidecar-client.ts`） | sheets 引擎 | cdylib `libxlsx_sidecar.so` + 系统 Native 子进程（`OH_Ability_StartNativeChildProcess`，socketpair fd 衔接 stdin/stdout），**客户端与协议零改动**（衔接层见 `xlsx-sidecar-host.ts`；开发机无启动壳回退 spawn） |
| MCP cli-runner（`process.execPath` + `ELECTRON_RUN_AS_NODE`，`apps/shell/src/main/index.ts`） | MCP server 的 headless CLI 工具 | 装载期禁用 MCP server |
| `explorer.exe`（win32 分支） | 回收站 | 无影响（win32-only） |
| `electron` / `node` ELF | 仅供 executableBinaryPaths 注册 | 已退役，统一包不入包 |

sidecar 衔接的选型要点：协议是 stdin/stdout 行式 JSON（`version`/`requestId`/`ok`/`result`/`error`），
客户端已有完整的请求排队、超时、取消抽象——**不重写客户端，只把 fd 适配成它期望的
ChildProcess 形状**（成员映射见 `xlsx-sidecar-host.ts` 文件头），Rust 侧 `run_stdio_main` 原样复用。

## 4. 落地形态：统一包（一个源树、一个 HAP）

设计期曾按「一个源树、两个 HAP」规划构建变体（2in1 版保留 `executableBinaryPaths`，
平板版裁剪）。实际落地**没有走双包**：引擎与全部子进程本就经 appspawn fork（无 exec），
launcher ELF 在 2in1 上也没有 exec 消费者，可执行位对两端都是死重——直接在统一包里退役：

| 差异点 | 统一包（落地） |
| --- | --- |
| `deviceTypes` | `["2in1","tablet"]`（entry 与 web_engine HAR 两处） |
| `executableBinaryPaths` | 无；残留 ELF 由 `build-genoffice.sh` 退役件清理 + 断言拦截 |
| `electron_exec_path_ohos` metadata | 无 |
| xlsx-sidecar | cdylib + Native 子进程（见 §3） |
| MCP cli-runner | 装载期禁用 |

## 5. 验证状态

| 项 | 状态 |
| --- | --- |
| 平板安装（证伪点） | 通过：统一包平板可装、可启动、可日常使用 |
| 启动点亮（shim/CDP/多模块渲染） | 通过：双端多次冷启动验证，无开机自开文档等启动期异常 |
| 六类型文件回归 | 通过 4 类：xlsx（磁盘打开→引擎加载→渲染）/ md / html（静默保存→磁盘重开→内容命中）/ pdf（落盘→打开→页指示），脚本 `scripts/e2e/six-type-regression.mjs`；**docx、pptx 与 xlsx 写回无设备级用例**（设备端无文件注入通道，写回无生产包 e2e 通道，见脚本头注释） |
| 触屏交互 | 未专项适配：应用是桌面指针假设，平板以外接鼠标/触控板使用 |
| 窗口形态（悬浮窗/分屏）、内存性能、坚盾守护模式 | 未专项验证 |
