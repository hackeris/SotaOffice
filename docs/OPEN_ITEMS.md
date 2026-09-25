# 未闭合项与技术债

这份文档是**登记处**：但凡"知道要做但还没做"的事都记在这里，做完就划掉。
不记在这里的，说明要么已闭环，要么根本没人知道——后一种情况请补进来。

## 一、配置与元数据没收尾

### `vendor` 还是占位符

`AppScope/app.json5` 里 `vendor: "example"`，从模板带过来的，一直没改。
**影响**：上架审核会卡。
**做法**：换成真实厂商名。

### 应用名和包名对不上

包名已经是 `app.fuqidian.sotaoffice`，而 `AppScope/resources/base/element/string.json`
里的 `app_name` 还是 **`GenOffice`**。桌面图标下面显示的就是这个名字。
**影响**：用户看到的名字和产品名不一致。
**做法**：这是去上游化改造的一部分，和 i18n 文案一起处理。

### TaskManagerAbility 没被声明

`entry/src/main/ets/entryability/TaskManagerAbility.ets` 文件在，但
`entry/src/main/module.json5` 的 `abilities` 数组里**没有它**（数组里只有
EntryAbility、BrowserAbility、StatelessAbility）。

**影响**：存疑——要么是漏声明，要么是早期留下的死文件。引擎按名字找 Ability，
三个必需的名字是 EntryAbility / StatelessAbility / TaskManagerAbility，
所以这个名字本身就是引擎契约的一部分。**动手前先查清楚它该不该在。**
**做法**：确认后，要么补声明，要么删文件。

### About 页的第三方声明没生成

`THIRD-PARTY-NOTICES.txt` 当前不存在。构建时会提示：

```
提示: 无 THIRD-PARTY-NOTICES.txt(跑 npm run notices 生成;About 页缺失,不阻塞)
```

**影响**：About 对话框里看不到第三方声明。不阻塞运行，但上架合规需要它。
**做法**：在应用仓库里跑 `npm run notices`，产物是 `apps/shell/build/THIRD-PARTY-NOTICES.txt`，
`build-genoffice.sh` 会自动拷进 resfile。

### `webContents.print` 降级没落地

M2 已定案（见 `M2_VERIFY_CHECKLIST.md` §D1）：fork 的 `webContents.print()` 回调正常触发但恒失败
（未对接系统打印服务），降级方案是**在 shim 里拦截 print 改走 `printToPDF`**。
但 shim 里至今没有任何 print 相关代码，`scripts/` 下也没有这条待办。

**影响**：用户点"打印"时静默失败（导出 PDF 不受影响）。
**做法**：在 shim 加 print 拦截桩，四个模块（docs/sheets/slides/pdf）逐个验。

## 二、机制上没验证过的

这些在 `MIGRATION_ISSUES.md` 里被标记过，但**没有完整的后续验证记录**（个别项只留下过部分观察，见表）。

| 项 | 为什么要验 |
| --- | --- |
| `fs.watch(recursive)` | 主页的文件列表靠它刷新；鸿蒙上的递归监视行为未确认 |
| `worker_threads` | 影响大文件处理时的 UI 阻塞 |
| 原生菜单的呈现 | 应用有十处 `Menu` 调用，真机上的样子没记录 |
| 多窗口与 presenter | slides 的演示模式依赖它 |
| 回收站、在文件管理器中显示 | 删除链的用户预期 |
| 拖放、深色模式 | 未验证 |

### 视觉基线（字体度量）

**从没启动过**。真机上只观察过"中文字体渲染正常、无豆腐块"——那是渲染结果，不是度量基线；
全仓没有一条字体度量数据。

这个不是小问题：应用靠渲染层做文字排版，CJK 字体在鸿蒙上的度量如果和桌面差得多，
排版会走样。应用本身有字体度量合并逻辑和 wasm 子集化，都需要一份真实基线才能调。

**做法**：先量 `系统字体目录是否可读`、`CJK 字体名与度量`，再决定要不要内嵌字体。

## 三、文档本身的债

### 上游回馈的提交状态未知

`UPSTREAM_FEEDBACK.md` 里有五条 fork 缺陷，整理得很完整，但**没记录是否已提交、
以什么编号跟踪**。时间一长就没人知道这些到底提没提。

## 四、发布相关

### 体积

HAP 三百多兆，而应用商店对单包体积有上限（具体数值待确认）。
一个可选的思路是切到官方的 electron-builder 方案，但那还是手工脚本阶段，没评估过。

### 法务

NOTICE 文件和隐私政策的内容需要法务确认。遥测已关闭（代码保留、本构建不注入 key，`initAnalytics()` 是 no-op 桩），隐私文档与隐私政策要跟着这个口径改——同步项挂在 `SOTA_RELEASE_TODO.md` §4.2 / §6.3。

### 去上游化还没做完

`SOTA_RELEASE_TODO.md` §9 的"阶段三"还挂着：i18n 品牌文案（六十多个文件）、
`GenSparkAccountStatus` 类型和对应 channel 的残留、未配置 AI 时的引导界面。
