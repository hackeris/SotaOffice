# M2 真机回归清单

> 前置:签名材料在 `scripts/.signing.snippet`(材料路径+口令)→ `npm run build:ohos` → 装机(报 9568332 先 `bm uninstall`)
> 判据:每条给**命令/操作 + 期望**。
> **shim 日志直读通道(2026-09-24 发现,首选)**:沙箱的**物理路径** hdc 可读——
> `hdc -t <dev> shell "tail -40 /data/app/el2/100/base/app.fuqidian.sotaoffice/files/shim-log.txt"`
> 此前用应用视角的 `/data/storage/el2/base/files/` 才报 Permission denied,两者不是同一路径。
> 该通道不受 hilog flowcontrol 影响,启动期日志不再缺段。
> 纪律:先记录基线事实,再定修复方案(不按推测改代码)
>
> **⚠ 装机后硬门槛(2026-09-24 实测,曾据此把"卡住"误判成"崩溃")**:三条 ACL
> (文档/下载/桌面)是 user_grant,首次启动必弹系统模态授权框(1/3→3/3)。
> **未授权(超时/拒绝)时窗口渲染进程不创建 → 应用走到 `window-all-closed`
> 静默退出**:退出码 0、无 uncaughtException、`ps` 里连 renderer 都没有,现象酷似
> 崩溃。**卸载重装会清空已授予的授权,故每次重装后都要跑** `bash scripts/grant-acl.sh`
> (自动点三次"允许" + 重启 + 核验三目录落点)。

## A. ACL 五件(本轮切终态的核心)

| # | 项 | 操作 | 期望 |
|---|---|---|---|
| A1 | JIT | 冷启动 | Home 正常渲染;**PDF 模块能渲染**(wasm 需 JIT;禁 JIT 时 pdfium 失效) |
| A2 | READ_PASTEBOARD 授权框 | 冷启动观察 | 弹系统授权框(user_grant) |
| A3 | 剪贴板读侧恢复 | 允许后看 hilog | `clipboard 读侧已恢复(授权信号确认)` |
| A4 | 剪贴板端到端 | 系统里复制文本 → 应用内粘贴 | 内容正确 |
| A5 | 三目录落点 | 看 hilog 第⑦桩 | 三条均报 `系统目录可写`(出现 `降级 → el2` 即该条 ACL 未生效) |
| A6 | 三目录写盘 | 另存到 Download / Desktop | 系统文件管理器可见该文件 |

> A2 若未弹框:检查 trim 声明与 profile ACL 是否覆盖 READ_PASTEBOARD(两门槛闭环,见 `M1_ACCEPTANCE.md` §4.1)。

## B. 文件关联

| # | 项 | 操作 | 期望 | 实测(09-24) |
|---|---|---|---|---|
| B1 | 关联注册 | 文件管理器长按 .docx → 打开方式 | 列表含 GenOffice | 待人工 |
| B2 | argv 链路 | 双击 .docx 启动 | 文档打开 | ✓ 冷启动通 |
| B3 | 文档真打开 | 同上,看 UI | 进 docs 模块并渲染该文档 | ✓ target 标题=文件名 |
| B4 | 六类抽验 | xlsx / pptx / pdf / md / html | 各进对应模块 | ✓ 六类全过 |
| B5 | 未知类型 | 双击 .txt | 回落 Home(不崩) | ✓ 明确回执不崩 |
| B6 | **热启动** | 应用运行时再开文件 | — | ✅ 已修:连续六次 `aa start -U` 均开新 tab 并渲染(见下方实测记录) |

> B3 曾是关键不确定点(want.uri 的临时授权 × 三目录 ACL 能否让 Chromium 以 POSIX 路径读到文件)——**已确证可行**:三目录 ACL + 系统对 want.uri 的授权叠加,路径可读性无问题。

## C. 窗口装饰(本轮改动回归)

| # | 项 | 操作 | 期望 |
|---|---|---|---|
| C1 | 三键 | 点最小化 / 最大化 / 关闭 | 均生效;关闭走脏数据检查链(编辑态先弹"是否保存") |
| C2 | 避让 | 看 tab 条右端 | 应用图标与三键**不重叠** |
| C3 | 避让自愈 | 最大化 → 还原 | 避让宽度 2s 内跟上 |
| C4 | 高度对齐 | 目视 | 三键中心与 tab 条中心重合 |
| C5 | 应用图标 | 桌面/最近任务 | 黑底白 G 的 GenOffice 图标(非系统默认蓝) |

## D. 基线事实(先拿事实,再定方案)

D1/D2/D4 已取到事实(见下方实测记录),**剩 D3 触屏待人工**。

| # | 项 | 操作 | 目的 |
|---|---|---|---|
| D1 | `webContents.print` 真实行为 | docs 里点"打印" | fork 上是报错 / 静默 / 可用?→ 据此定打印降级方案(勿按 PrintAdapter TODO 推测) |
| D2 | 设备能力上报 | CDP:`matchMedia('(hover: hover)')` / `maxTouchPoints` | 是否仍全空 → 决定是否试 Chromium 开关(`--touch-events` 等) |
| D3 | 触屏操作 | 触屏点各处 UI | 记录死区与尺寸问题 |
| D4 | 崩溃治理 | 反复开关文档/退出 | hilog 抓 `dlclose`/`SIGSEGV` 类记录 |

## 实测记录(2026-09-24;两轮:未授权 → 授权完成后同一 HAP 热重启)

**第一轮(未授权)**:探针文件未生成(EPERM)、三目录全降级、无 renderer 进程——
现象是"启动后卡住/静默退出",根因即上方 ACL 硬门槛。

**第二轮(授权完成后)**:

| 项 | 实测 | 证据 |
|---|---|---|
| A1 JIT | ✅ | Home 与六模块 UI 全渲染 |
| A2 授权框 | ✅ | 截图:系统模态框依次 1/3 文档 → 2/3 下载 → 3/3 桌面 |
| A3 剪贴板读侧 | ✅ | shim:`stub: clipboard 读侧已恢复(授权信号确认)` |
| **A5 三目录落点** | ✅ **三条全可写** | shim:`documents/downloads/desktop: 系统目录可写`,不降级 |
| A6 三目录写盘 | ✅ | 桌面可见 probe.{md,txt,html,pdf,docx,xlsx,pptx} 七个图标 |
| A4 剪贴板端到端 | 待人工 | — |
| **B2/B3/B4 文件关联** | ✅ **六类全进对应模块** | `verify-file-assoc.sh`:六类 target 依次出现;窗口内六 tab 标题即文件名,html 正文已渲染 |
| B5 未知类型 | ✅ **明确回执、不崩** | shim:`open-doc: reply {"ok":false,"reason":"unsupported"}`;UI 弹"暂不支持 .txt 类型" |
| B6 热启动 | ✅ | 应用运行中 `aa start -U` 连续六次均开新 tab 并渲染 |
| C1 三键 | ✅ **四动作全验** | 最小化(窗口隐/进程存)→ 最大化 `[0,0][3120,1955]` → 还原 `[266,119][2850,1830]`(回原位)→ 关闭(shim:`window-all-closed→before-quit→will-quit→exit code=0`) |
| C2 避让 | ✅ | spacer=140px;窗口态与最大化态均与系统三键不重叠(截图) |
| C3 避让自愈 | ✅ | 最大化↔还原全程 spacer 恒 140px(系统容器不变,无需修正) |
| C5 应用图标 | 待目视 | — |
| **D1 打印真实行为** | ❌ **不可用(静默取消)** | 传合法 `WorkbookExportPdfRequest` 调 `printWorkbook` → `{ok:false}`(无 error 字段)。对照 `sheets/pdf-export.ts:88-92`,**无 error 的 `{ok:false}` 只对应 `failureReason==='Print job canceled'`** → fork 的 `webContents.print()` **回调正常触发但恒失败**(未对接系统打印服务)。**降级方案据此定案:shim 拦截 print → printToPDF**(尚未落地,见 `OPEN_ITEMS.md`) |
| **D2 设备能力上报** | ❌ **全空** | `hover/anyHover/pointer:fine/pointer:coarse/any-pointer:coarse` **全 false**,`maxTouchPoints: **0**`,`ontouchstart: false`;而 UA 自称 `(OHOS; PC; OpenHarmony 7.0.0; MOR-M1)`。⚠ **`pointer: fine` 与 `coarse` 双 false** 是最差组合:任何依赖这些媒体查询的 CSS 分支都会落空 |
| D3 触屏 | 待人工 | 受 D2 全空影响,触屏行为需实测 |
| D4 崩溃治理 | ✅ | 多轮冷/热启动 + 六模块切换,无 SIGSEGV/SIGABRT/CPP_CRASH/FaultLogger |

> **自动化通道(本轮打通,修正此前"该路径成本过高"的结论)**:
> * `uitest` **可点 Electron 应用内 DOM**(无障碍树里可见 `菜单/关闭标签/保存/AI 总结` 等),
>   也能点系统弹窗(授权框);**但系统标题栏三键不在树里**——按坐标硬点会误触
>   "全部标签"按钮(实测踩过)。
> * 三键坐标:窗口态 `[266,119][2850,1830]` → 最大化 (2636,142) / 最小化 (2722,142) /
>   关闭 (2797,142);最大化态 `[0,0][3120,1955]` → (2900,35) / (2978,35) / (3055,35)。
> * 取证首选 `snapshot_display -f`(截图肉眼判读,比 hilog 直观),见命令备忘。
> * 结构化编辑器(HTML/Markdown)下 `uitest uiInput inputText` 不落字(点中块会弹浮动
>   工具条),**编辑态脏检查链仍须人工**。

## 命令备忘

```bash
# 装 + 起
hdc file send entry/build/default/outputs/default/entry-default-signed.hap /data/local/tmp/go.hap
hdc shell "bm install -p /data/local/tmp/go.hap && aa start -a EntryAbility -b app.fuqidian.sotaoffice"
# ⚠ 装机后必须授权,否则应用静默退出(见顶部硬门槛);脚本自动点三次"允许"+重启+核验
bash scripts/grant-acl.sh <device>

# shim 日志(首选:直读沙箱物理路径,不受 flowcontrol 影响)
hdc -t <device> shell "tail -40 /data/app/el2/100/base/app.fuqidian.sotaoffice/files/shim-log.txt"
# 备选:hilog(-x 为非阻塞 dump 后退出;启动期日志常被流控丢弃)
hdc shell "hilog -x | grep GO-SHIM"

# 取证截图(比 hilog 直观;拉回本地后直接看图)
hdc -t <device> shell "snapshot_display -f /data/local/tmp/scr.jpeg"
hdc -t <device> file recv /data/local/tmp/scr.jpeg /tmp/scr.jpeg

# UI 自动化:先 dump 拿 bounds,再点其中心(系统弹窗与 Electron DOM 都可用)
hdc -t <device> shell "uitest dumpLayout -p /data/local/tmp/l.json"
hdc -t <device> file recv /data/local/tmp/l.json /tmp/l.json
hdc -t <device> shell "uitest uiInput click 1741 1132"

# 探针(shim 桩⑯ 注入 shell 页,CDP 9333 可读):三目录落点/可写性 + 剪贴板授权信号
node /tmp/probe-info.mjs                     # 打印 window.__GO_INFO__

# 文件关联抽验(六类 + 未知类型回落;脚本内含前提与判据)
bash scripts/verify-file-assoc.sh <device>
```

> 文件关联抽验的**前提**:桌面上要有 probe.* 测试文件。hdc 侧一律写不进 `/storage/Users`
> (命名空间隔离,非权限问题),所以只能在设备上由应用自己准备——新建文档后"另存为"到桌面。
