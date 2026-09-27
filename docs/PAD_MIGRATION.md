# 平板（tablet）支持：现状与边界

**结论**：统一包允许 tablet 安装运行（与 2in1 同一 HAP、同一份代码），但 **pad 不做专项适配**
（2026-09 决策）。工程主战场是 2in1（键鼠形态）。pad 上的已知边界见 §4。

## 1. 统一包为什么能装平板

- `executableBinaryPaths` 是 2in1 专属声明（API 24 起，仅 PC/2in1 生效），声明了它平板在安装期
  直接拒装（`9568449`）。统一包已整体退役可执行位：引擎与全部子进程经 appspawn fork（无 exec），
  launcher ELF 无消费者。可执行位对两端都是死重。
- 引擎链在平板可用：V8 JIT 权限（`ALLOW_WRITABLE_CODE_MEMORY`）官方口径为「平板、PC/2in1 可申请」；
  Chromium 子进程走 `childProcessManager.startChildProcess(APP_SPAWN_FORK)`，官方文档明示平板可正常调用。
- xlsx-sidecar 走系统 Native 子进程（`OH_Ability_StartNativeChildProcess` + socketpair fd），
  与设备类型无关。

## 2. 落地形态

| 差异点 | 统一包（现状） |
| --- | --- |
| `deviceTypes` | `["2in1","tablet"]`（entry 与 web_engine HAR 两处） |
| `executableBinaryPaths` | 无；退役 ELF 由 `build-genoffice.sh` 清理 + 断言拦截 |
| `electron_exec_path_ohos` metadata | 无 |
| UA 设备标记 | shim 桩⑲：UA 含 `TABLET` 时替换为 `PC`（2in1 无感），见 §4 |
| xlsx-sidecar | cdylib + 系统 Native 子进程（`docs/PORT_DESIGN.md` §5） |
| MCP cli-runner | 装载期禁用 |

## 3. 验证状态（pad 真机）

| 项 | 状态 |
| --- | --- |
| 安装、启动、多模块渲染 | 通过 |
| 六类型回归（xlsx/md/html/pdf） | 通过（`scripts/e2e/six-type-regression.mjs`；docx/pptx 无设备级用例，见脚本头注释） |
| sheets 网格输入（触摸/鼠标） | 可用（UA 归一桩，见 §4；编辑/选中已真机验证） |
| 其余模块触屏基础交互（点击/聚焦/工具栏/滚动） | 可用（未做触屏专项优化） |
| 触屏专项适配（拖放/hover/缩放等） | 未做（决策：不做） |
| 窗口形态（悬浮窗/分屏）、内存性能、坚盾守护 | 未验证 |

## 4. 触屏/指针支持边界

应用是桌面指针假设（全仓零 touch 处理），pad 上未做适配。各模块现状：

- md / docs / html / pdf / slides：基础触屏交互（点击、聚焦、工具栏、滚动，slides 的图形选中拖拽）可用。
- **sheets：网格输入可用**（触摸/外接鼠标的选中、编辑）。前提是 shim 桩⑲把 UA 里的
  `TABLET` 标记归一为 `PC`：fork 按系统设备类型注入 UA 标记，按 UA 判设备类型的页面
  （如 Univer）在 tablet 分支下不消费输入，输入类型无关；归一为 PC 后全链恢复。
  根因证据与 fork 侧建议见 `UPSTREAM_FEEDBACK.md` #6。
- 未适配的桌面假设缺口（触屏专项，未做）：HTML5 拖放（触屏不触发 dragstart）、捏合/双击缩放
  未禁、hover 驱动显隐无 hover-out 语义、长按菜单与文本选择冲突、软键盘无修饰键（快捷键均有
  菜单替代入口）。
