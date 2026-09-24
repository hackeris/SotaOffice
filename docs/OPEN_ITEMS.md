# 未闭合项与技术债

这份文档是**登记处**：但凡"知道要做但还没做"的事都记在这里，做完就划掉。
不记在这里的，说明要么已闭环，要么根本没人知道——后一种情况请补进来。

## 一、代码里明确标着"发布前移除"的

### 桩⑱ 真机测试文件生成

`scripts/shim/main-shim.mjs` 里注释写着"B2-B6 文件关联抽验专用；发布前移除"。
它往桌面写七个探针文件（md/html/txt/pdf/docx/xlsx/pptx），是文件关联抽验的前提——
因为 hdc 侧根本写不进公共目录，只能让应用自己造。

**影响**：一个办公软件往用户桌面塞七个 `probe.*` 文件，发布版不能留着。
**做法**：移除桩，或至少默认设为关闭（现在可用 `GO_TEST_FILES=0` 关）。

### 桩⑲ 退出诊断

同样标着"发布前移除"。只做一件事：把退出链上每个事件（`window-all-closed`、
`before-quit`、`will-quit`、`quit`、`process exit`）打进日志。

**影响**：纯噪音，但无害。它当初是为了区分"窗口全关触发的默认退出"和"应用主动 quit"。
**做法**：和桩⑱ 一起移除。移除前记得写进 `PITFALLS.md`——它记录的那个
"bundle 加载成功却 15 秒退出"的现象还没最终定论。

> 这两项在源码里只是注释，**没有任何清单追踪**。这份文档就是那个清单。

## 二、配置与元数据没收尾

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

### 四套命名并存

仓库叫 `smartoffice-ohos`、产品叫 Sota Office、代码标识符还是 `GenOffice`、
早期脚本注释里写 `genoffice-ohos`。`SOTA_RELEASE_TODO.md` 只讲了代码怎么改，
没讲这几个名字的收敛规则。
**做法**：定一条规则写进 `CLAUDE.md`，避免新人反复问。

## 三、机制上没验证过的

这些在 `MIGRATION_ISSUES.md` 里被标记过，但**全仓找不到任何后续验证记录**。

| 项 | 为什么要验 |
| --- | --- |
| `fs.watch(recursive)` | 主页的文件列表靠它刷新；鸿蒙上的递归监视行为未确认 |
| `worker_threads` | 影响大文件处理时的 UI 阻塞 |
| 原生菜单的呈现 | 应用有十处 `Menu` 调用，真机上的样子没记录 |
| 多窗口与 presenter | slides 的演示模式依赖它 |
| 回收站、在文件管理器中显示 | 删除链的用户预期 |
| 拖放、深色模式 | 未验证 |

### 视觉基线（字体）

**从没启动过**。POC-6 在计划里一直挂着"待启动"，全仓没有一条真机字体数据。

这个不是小问题：应用靠渲染层做文字排版，CJK 字体在鸿蒙上的度量如果和桌面差得多，
排版会走样。应用本身有字体度量合并逻辑和 wasm 子集化，都需要一份真实基线才能调。

**做法**：先量 `系统字体目录是否可读`、`CJK 字体名与度量`，再决定要不要内嵌字体。

## 四、文档本身的债

### 承诺过但没写的文档

`PORT_DESIGN.md` 开头列过两份配套文档：`KEYPOINTS.md`（不可变决策与踩坑）和
`FEATURE_MATRIX.md`（能力矩阵与验收）。**两份都没写。**

它们要承载的内容现在散在别处——前者在 `PORT_DESIGN.md` §0 与 `PITFALLS.md`，
后者在 `ELECTRON_OHOS_CHECKLIST.md` §5 与 `M1_ACCEPTANCE.md`。
要么补写，要么把那行承诺改掉（已改为指向现有文档）。

> 早先审计列过一批"死引用"（`dialog.sh`、`copy.sh`、`save-signing.sh` 等），
> 复核后确认是误判：`dialog.showSaveDialog` 之类是 API 名而非文件名，
> `copy.sh` 属于官方指导项目，`build-app.sh` 的退役在正文里已有说明。不需要处理。

### 上游回馈的提交状态未知

`UPSTREAM_FEEDBACK.md` 里有五条 fork 缺陷，整理得很完整，但**没记录是否已提交、
以什么编号跟踪**。时间一长就没人知道这些到底提没提。

### 部分文档的结论已经过期但没标注

见 `README.md` 的「读之前先知道」一节，那里列了五处。已经在索引里做预警，
但没有逐处修正。

## 五、仓库风险

### submodule 的 fetch 源指向 `.temp/`

两个 submodule 的 `origin` 现在都是 `file://` 指向 `.temp/` 下的本地副本。
**`.temp/` 一删，`git submodule update` 就再也拉不回来。**

### 有两个 commit 不在任何远端

应用仓库的 `ohos/sota-debrand` 分支上有两个 commit（这两周的去上游化改造），
**它们只存在于 `.git/modules/` 里**——那个分支没有 upstream，本地副本里也没有这两个对象，
从任何已记录的 remote 都拉不到。

`thirdparty/VERSIONS.md` 里给的 tag 校验命令现在跑会直接失败（它还以为锚在 `ohos-v1.0.0`）。

**做法**：把分支推到 fork 上，然后 `git submodule sync`。这是当前最该先处理的一件事。

## 六、发布相关

### 体积

HAP 三百多兆，而应用商店对单包体积有上限（具体数值待确认）。
一个可选的思路是切到官方的 electron-builder 方案，但那还是手工脚本阶段，没评估过。

### 法务

NOTICE 文件和隐私政策的内容需要法务确认。改造删掉了遥测，隐私政策也得跟着改。

### 去上游化还没做完

`SOTA_RELEASE_TODO.md` §9 的"阶段三"还挂着：i18n 品牌文案（六十多个文件）、
`GenSparkAccountStatus` 类型和对应 channel 的残留、未配置 AI 时的引导界面。
