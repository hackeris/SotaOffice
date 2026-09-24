# M2 真机回归清单(sotaoffice profile 到位后执行)

> 前置:新 profile(p7b)写入 `scripts/.signing.snippet`(材料路径+口令)→ `npm run build:ohos` → 装机(报 9568332 先 `bm uninstall`)
> 判据:每条给**命令/操作 + 期望**;shim 日志走 hilog:`hdc shell "hilog | grep GO-SHIM"`(沙箱内文件日志 hdc 直读不可用)
> 纪律:先记录基线事实,再定修复方案(不按推测改代码)

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

## B. 文件关联(本轮新增,待验路径)

| # | 项 | 操作 | 期望 | 实测(09-24) |
|---|---|---|---|---|
| B1 | 关联注册 | 文件管理器长按 .docx → 打开方式 | 列表含 GenOffice | 待人工 |
| B2 | argv 链路 | 双击 .docx 启动 | 文档打开 | ✓ 冷启动通 |
| B3 | 文档真打开 | 同上,看 UI | 进 docs 模块并渲染该文档 | ✓ target 标题=文件名 |
| B4 | 六类抽验 | xlsx / pptx / pdf / md / html | 各进对应模块 | docx ✓ 余待测 |
| B5 | 未知类型 | 双击 .txt | 回落 Home(不崩) | 待测 |
| B6 | **热启动** | 应用运行时再开文件 | — | ✗ **白窗口**(缺口与根因见 `PORT_DESIGN.md` §11.9) |

> B3 是**关键不确定点**:want.uri 的临时授权 × 三目录 ACL 能否让 Chromium 以 POSIX 路径读到文件。

## C. 窗口装饰(本轮改动回归)

| # | 项 | 操作 | 期望 |
|---|---|---|---|
| C1 | 三键 | 点最小化 / 最大化 / 关闭 | 均生效;关闭走脏数据检查链(编辑态先弹"是否保存") |
| C2 | 避让 | 看 tab 条右端 | 应用图标与三键**不重叠** |
| C3 | 避让自愈 | 最大化 → 还原 | 避让宽度 2s 内跟上 |
| C4 | 高度对齐 | 目视 | 三键中心与 tab 条中心重合 |
| C5 | 应用图标 | 桌面/最近任务 | 黑底白 G 的 GenOffice 图标(非系统默认蓝) |

## D. 待确立基线(先拿事实,再定方案)

| # | 项 | 操作 | 目的 |
|---|---|---|---|
| D1 | `webContents.print` 真实行为 | docs 里点"打印" | fork 上是报错 / 静默 / 可用?→ 据此定打印降级方案(勿按 PrintAdapter TODO 推测) |
| D2 | 设备能力上报 | CDP:`matchMedia('(hover: hover)')` / `maxTouchPoints` | 是否仍全空 → 决定是否试 Chromium 开关(`--touch-events` 等) |
| D3 | 触屏操作 | 触屏点各处 UI | 记录死区与尺寸问题 |
| D4 | 崩溃治理 | 反复开关文档/退出 | hilog 抓 `dlclose`/`SIGSEGV` 类记录 |

## 本轮实测记录(2026-09-24,HAP 冷启动 + CDP/hilog 双通道)

| 项 | 实测 | 证据 |
|---|---|---|
| A1 JIT | ✅ | Home 渲染正常(未单独验 PDF) |
| A2/A3 剪贴板 | ✅ 已授权 | 探针 `clipGrant: granted` |
| **A5 三目录落点** | ✅ **三条全可写** | 探针 `pathWritable: {documents:system, downloads:system, desktop:system}` |
| A4 剪贴板端到端 | 待人工 | — |
| A6 三目录写盘 | 间接 ✅ | shim 日志正写 `/storage/Users/currentUser/Documents/GenOffice/`;文件管理器可见性待人工 |
| **B2/B3/B4 文件关联** | ⛔ **阻塞** | **测试文件已不存在**(`test.docx` 打开失败);**且 hdc 无法创建**——shell 对 `/storage/Users/` 是 `Permission denied`(命名空间隔离,非权限问题) |
| B5 未知类型 | ✅ 不崩 | 三次 `.txt` 触发(`probe1-3.txt`)全程无崩溃,应用存活,targets 无异常 |
| **B6 热启动链路** | ✅ **日志证明通路** | hilog:`open-document(hot): .../probe3.txt` ×3 —— **onNewWant → 路径解析全通**;受测试文件缺失影响,未验"文件真打开" |
| C2 避让 | ✅ | `.tab-bar-caption-spacer` = **140px**(匹配系统容器 139.5px) |
| C1/C3/C5 | 未验 | `uitest uiInput click` 执行成功("No Error")但窗口无响应——物理/vp 两套坐标均试过,**该自动化路径成本过高**;C1 关闭链此前已验(exit code 0) |
| **D1 打印真实行为** | ❌ **不可用(静默取消)** | 传合法 `WorkbookExportPdfRequest` 调 `printWorkbook` → `{ok:false}`(无 error 字段)。对照 `sheets/pdf-export.ts:88-92`,**无 error 的 `{ok:false}` 只对应 `failureReason==='Print job canceled'`** → fork 的 `webContents.print()` **回调正常触发但恒失败**(未对接系统打印服务)。**降级方案据此定案:shim 拦截 print → printToPDF** |
| **D2 设备能力上报** | ❌ **全空** | `hover/anyHover/pointer:fine/pointer:coarse/any-pointer:coarse` **全 false**,`maxTouchPoints: **0**`,`ontouchstart: false`;而 UA 自称 `(OHOS; PC; OpenHarmony 7.0.0; MOR-M1)`。⚠ **`pointer: fine` 与 `coarse` 双 false** 是最差组合:任何依赖这些媒体查询的 CSS 分支都会落空 |
| D3 触屏 | 待人工 | 受 D2 全空影响,触屏行为需实测 |
| D4 崩溃治理 | ✅ | 三次连续触发 + 冷启动切换,无 SIGSEGV/SIGABRT/CPP_CRASH/FaultLogger |

> **阻塞解法(下轮构建一并做)**:给 shim 加"造测试文件"桩——shim 是 Node 环境且有公共目录写权(日志已证),可生成 docx/xlsx/pptx/pdf/md/html 落 Desktop,随后 B2/B3/B4/B6 可一次扫完。

## 命令备忘

```bash
# 装 + 起
hdc file send entry/build/default/outputs/default/entry-default-signed.hap /data/local/tmp/go.hap
hdc shell "bm install -p /data/local/tmp/go.hap && aa start -a EntryAbility -b app.fuqidian.sotaoffice"

# shim 日志(注:hilog 会被 flowcontrol 丢日志,启动期日志常缺;以探针为准)
hdc shell "hilog -x | grep GO-SHIM"          # -x: 非阻塞 dump 缓冲区后退出

# 探针(shim 桩⑯ 注入 shell 页,CDP 9333 可读):三目录落点/可写性 + 剪贴板授权信号
node /tmp/probe-info.mjs                     # 打印 window.__GO_INFO__

# 文件关联手测(不依赖文件管理器 UI)
hdc shell "aa start -a EntryAbility -b app.fuqidian.sotaoffice -U file://docs/storage/Users/currentUser/Desktop/test.docx"
```
