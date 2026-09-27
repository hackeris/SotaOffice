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
| xlsx-sidecar | cdylib + 系统 Native 子进程（`docs/PORT_DESIGN.md` §5） |
| MCP cli-runner | 装载期禁用 |

## 3. 验证状态（pad 真机）

| 项 | 状态 |
| --- | --- |
| 安装、启动、多模块渲染 | 通过 |
| 六类型回归（xlsx/md/html/pdf） | 通过（`scripts/e2e/six-type-regression.mjs`；docx/pptx 无设备级用例，见脚本头注释） |
| sheets 网格输入（触摸/鼠标） | **不可用**——引擎缺陷，见 §4 与 `UPSTREAM_FEEDBACK.md` #6 |
| 其余模块触屏基础交互（点击/聚焦/工具栏/滚动） | 可用（未做触屏专项优化） |
| 触屏专项适配（拖放/hover/缩放等） | 未做（决策：不做） |
| 窗口形态（悬浮窗/分屏）、内存性能、坚盾守护 | 未验证 |

## 4. 触屏/指针支持边界

应用是桌面指针假设（全仓零 touch 处理），pad 上未做适配。各模块现状：

- md / docs / html / pdf / slides：基础触屏交互（点击、聚焦、工具栏、滚动，slides 的图形选中拖拽）可用。
- **sheets：网格输入整体不可用**——触摸与外接鼠标均无法选中/编辑单元格；引擎把事件完整送达页面
  （探针逐项核对，坐标与属性全部正常）但 Univer 状态机不消费，输入类型无关。已用双向对照
  （同页在系统浏览器正常、fork 内失效）排除应用层与 Univer 本身，定性为 fork 引擎在 tablet 形态的
  输入消费缺陷。应用侧无可行自救（设备能力伪装、事件翻译、内部合成均已实测无效）。
  全部证据与排除清单在 `UPSTREAM_FEEDBACK.md` #6，随 fork 修复后复测。
- 未适配的桌面假设缺口（若未来恢复 pad 支持，需按此清单评估）：HTML5 拖放（触屏不触发
  dragstart）、捏合/双击缩放未禁、hover 驱动显隐无 hover-out 语义、长按菜单与文本选择冲突、
  软键盘无修饰键（快捷键均有菜单替代入口）。
