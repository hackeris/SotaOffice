# 品牌替换方案

把上游的 **GenOffice** / **Genspark** 牌子换成 **Smart Office**。
要执行的任务清单在 `SOTA_RELEASE_TODO.md` §3，本文讲**怎么做**。

## 一、先分清三类

残留不是"找个词换掉"就完事。按**用户能不能看到**分三类，处理方式完全不同：

| 类 | 判据 | 处理 | 规模（源码口径，估） |
| --- | --- | --- | --- |
| **换词** | 功能还在，牌子是上游的 | 替换字符串 | 约 500 处 |
| **删码** | 文案描述的功能已被移除 | 删 key 与调用点 | 约 430 处 |
| **不动** | 内部标识，用户看不见 | — | 约 4200 处 |

数字不含 `out/` `dist/` `node_modules/`——那些是构建产物，重跑就没了。
这里是量级，准确数要等脚本 `--dry-run` 跑一遍（见 §7）；分类边界本身也要靠那一跑才划得准。

**第二类是重点，也是最容易按词替换搞砸的地方。** `Genspark` 系列的文案里，
大半描述的是**已经不存在的功能**：账号链在阶段二移除了，文案却留在 i18n 里成了死键。
按词替换会把它们变成「新品牌 + 假功能」——比原样留着更糟，因为那时它看着是活的。

## 二、换词：改哪些

### 名称映射

| 场合 | 现在 | 改成 | 说明 |
| --- | --- | --- | --- |
| 产品显示名 | `GenOffice` | **`Smart Office`** | 带空格，用于标题、About、菜单 |
| 紧凑形式 | `GenOffice` | **`SmartOffice`** | 不带空格，用于 UA、标识符、包名段 |
| 包名 | `com.genoffice.app` | `app.fuqidian.sotaoffice` | HAP 侧已经是新的了；**bundleName 不随显示名变** |
| 默认保存目录 | `Documents/GenOffice` | `Documents/Smart Office` | **跨仓联动，见 §5**；已落地 |
| 窗口标题 | `GenOffice Docs` 等 7 处 | `Smart Office Docs` 等 | `<title>` + 主进程 `title:`；已落地 |
| AI 面板品牌 | `Genspark` | **`AI`** | 不引入第二个品牌。见 `ribbonAiAssistant` / `aiPanelTitle` |
| AI User-Agent | `GenOffice` | `SotaOffice/<version>` | |
| MCP server name | `GenOffice` | `SotaOffice` | MCP 客户端里能看见 |

### 位置清单

**i18n（主战场）**

| 位置 | 量 | 内容 |
| --- | --- | --- |
| `packages/electron-utils/src/app-menu.ts` | 23 处 × 20 语言 | `about: 'About GenOffice'` |
| `apps/shell/src/renderer/src/strings.ts` | 320 处 | 集成页、Star 推广、Onboarding——**多半是死键，见 §3** |
| 各 app `renderer/i18n/**` | docs 20 处 | 其余 app 的 i18n 目录里没有 `GenOffice` |

**代码与资产**

| 位置 | 内容 |
| --- | --- |
| 7 个 `apps/*/src/renderer/index.html` | `<title>GenOffice Xxx</title>` |
| `apps/shell/src/main/index.ts` | 窗口 `title`、错误串、`GENTEAM_URL`、star 计数端点 |
| `GensparkMark`（5 个 app 的 AI 面板） | 组件名 + 图标图形，共 15 处引用 |
| `apps/shell/src/renderer/src/assets/genoffice-logo.svg` | Logo，要换图形 |
| 各 app `renderer/assets/app-icon.png` | AI 面板图标 |
| `apps/*/build/icon*`（icns/ico/png） | 桌面打包图标——鸿蒙不用，但同名资产要一致 |
| 字体族名 `GenOffice Sans KR` / `Serif KR` / `Gothic KR` | 见 §6 待定 |
| `packages/cli/src/agent-skills.ts:25` | `SKILL_NAME = 'genoffice'` |

**注意**：`fonts.css` 里还有 `Carlito GO`、`Noto Sans CJK GO`、`Nunito Sans GO` 这类
带 `GO` 后缀的族名。那是**内部命名约定**（GenOffice 的缩写），不是品牌露出，
改名要动 `line-metrics.ts` 的度量数据与测试断言，收益为零——**不动**。

## 三、删码：哪些功能已经没了

账号链移除后，这些 UI 入口**已经不在代码里**，只有 i18n 的死键还留着：

| key | 出现 | 原语义 | 处理 |
| --- | --- | --- | --- |
| `aiGskLoginBtn` | 60 | "登录 Genspark" 按钮 | 删 |
| `aiCreditsExhausted` | 52 | 积分用完，去 genspark.ai 充值 | 删（无积分体系） |
| `ribbonAiAssistant` | 60 | Ribbon 的 AI 助手名 | **换词** → 自有 AI 品牌 |
| `aiPanelTitle` | 40 | AI 面板标题 | **换词** → 自有 AI 品牌 |
| `appSettingsLogin` / `appSettingsAccount` | 40 | 设置页账号 | 删 |
| `appNotLoggedIn` / `appLoginGenspark` | 40 | 未登录提示 | 删 |
| `appGensparkAccount` / `aiGensparkAccount` | 40 | 账号名 | 删 |
| `aiLoginGenspark` | 20 | 登录入口 | 删 |
| `appSettingsLoggedOut` | 19 | 已登出 | 删 |
| `aiNotLoggedIn` | 20 | AI 未登录 | **改写**为"未配置 AI 模型服务" |

（60 = 3 个 app × 20 语言，20 = 1 个 app × 20 语言。）

**删的方式**：key 定义和调用点一起删。只删定义会留悬空引用；
只删调用点会留死键——两种情况都要在 `typecheck` 里暴露出来才算删干净。

同类的还有三块，都在 `SOTA_RELEASE_TODO.md` 里另有条目：

- **集成页**（`intg*` 系列，约 60 个 key）——UI 已随账号链移除，但
  `apps/shell/tests/settings-integrations.test.ts` 还在 import 已不存在的 `IntegrationsPane`
- **Star 推广**（`star*` 系列）——`starPrompt.ts` 整个文件 + `StarPromptCard.tsx`
- **自动更新**——`updater.ts`、更新 UI 入口（鸿蒙侧走应用市场，整体移除）

## 四、不动：内部标识

| 标识 | 规模 | 为什么不动 |
| --- | --- | --- |
| `@genoffice/*` workspace 包名 | 1470+ 处 / 1200 文件 | 改要动整个 monorepo 的模块解析，用户永远看不见 |
| `GENOFFICE_*` 环境变量 | 198 处 / 53 文件 | 内部约定（`GENOFFICE_USER_DATA` 等） |
| 代码注释里的上游 issue 引用 | — | `genspark-ai/genoffice#55` 这类是溯源信息 |
| `fonts.css` 的 `* GO` 族名后缀 | — | 内部命名约定，见 §2 末 |
| `.genoffice-assets.json` 等运行时文件名 | 少量 | 纯内部状态文件，改了要连带迁移逻辑 |

判断标准只有一条：**用户有没有机会看到**。看不到的，改名成本再低也不划算——
每一处改动都是下一次合并上游时的冲突点。

## 五、跨仓联动：`Documents/GenOffice`

这个目录名出现在**两个仓**，改的时候必须同步：

| 仓 | 文件 | 用途 |
| --- | --- | --- |
| 应用仓 | `packages/electron-utils/src/default-save-dir.ts:55` | 用户"另存为"的默认落点 |
| 壳仓 | `scripts/shim/main-shim.mjs:31` | `shim-log.txt` 的写入路径 |
| 壳仓 | `scripts/shim/main-shim.mjs:117` | documents 可写性探测的候选路径 |

漏改的后果是**静默错位**：应用把文件存到新目录，shim 的日志还在写老目录。
两边都不会报错，只是排查问题时日志找不到了。

壳仓这边改完要重跑 `build-genoffice.sh` 才会生效——shim 的源在 `scripts/shim/`，
构建产物是另一份。

## 六、待拍板

方案要落地，这几项得先定：

**已定**：AI 面板的品牌名就是 **`AI`**——不引入第二个品牌。

| # | 事项 | 建议 | 影响 |
| --- | --- | --- | --- |
| 1 | **品牌图**（Logo / 图标） | 需要设计出图 | 阻塞 §7 的 B3 批次；壳工程现在的图标是"黑底白 G"，那个 G 也是上游的 |
| 2 | **`GensparkMark` 换什么图形** | 通用 AI 图标，或直接去掉 | 5 个 app 共 15 处引用。名字也要改（`AiMark`） |
| 3 | **自有域名** | 需要 | 外链落点（About、Star、字体 CDN） |
| 4 | CLI 命令名 `genoffice` | `sota` | `packages/cli/bin/genoffice`、skill 名、MCP 示例。鸿蒙侧 CLI 未进包，不紧急 |
| 5 | 字体族名 `GenOffice *` | **改**（成本低，纯字符串） | 要同步 `fonts.css` + `line-metrics.ts` + 文件名 + 测试断言 |
| 6 | `~/.genoffice` 目录 | `~/.sotaoffice` | `cli-link.ts`、`GENOFFICE_AUTH_DIR`。桌面端概念，鸿蒙侧不涉及 |

第 1 项是唯一会**阻塞**的：没有品牌图，B3 批次做不了，HAP 里会留着上游图标。

## 七、执行

### 脚本

批量替换必须脚本化（1410+ 处手改不可复现）。建议放应用仓 `tools/debrand.mjs`，
和 `check-licenses.mjs` / `gen-third-party-notices.mjs` 做邻居：

- **规则表驱动**：每条规则写明「匹配什么、换成什么、属于换词还是删码」
- **白名单跳过**：`@genoffice/`、`GENOFFICE_`、`* GO` 族名 —— 防止误伤
- **`--dry-run`**：先出报告（每条规则命中多少处、在哪些文件），人工过一遍再实跑
- **幂等**：可重复执行，第二次跑应该零命中

### 批次

按「能不能独立验证」切，不按词切：

| 批次 | 内容 | 前置 | 验证 |
| --- | --- | --- | --- |
| **B1** | 删死码（账号/积分/集成页/Star/更新） | 无 | typecheck 无悬空引用；构建通过 |
| **B2** | 换词（GenOffice → Sota Office） | 名称映射定稿 | 全量搜索零残留；真机看标题与 About |
| **B3** | 资产（Logo、图标、AI 面板图形） | **品牌图到位** | 真机看图标 |
| **B4** | 外链与端点（About、Star、字体 CDN、代理探测） | 自有域名 | 逐个点 |
| **B5** | 壳工程（`app_name`、Ability 标签、`gen-icons.py` 源、shim 路径） | B2、B3 | 装机看桌面名与图标 |
| **B6** | 文档与仓库元信息（README、PRIVACY、`package.json`） | B2 | — |

B1 可以立刻开始，不依赖任何待定项。B2 卡在 §6 的 1、3 两项。B3 卡在图。

### 验证

每批次结束跑：

```sh
cd thirdparty/genoffice
npm run typecheck          # 悬空引用会在这里暴露
npm run build:all
```

全部批次结束后跑真机：

```sh
npm run build:ohos && bash scripts/grant-acl.sh <device>
node scripts/e2e/ohos-smoke.mjs
```

**20 种语言要抽查**——批量替换最容易在含变量的句子上翻车（语序不同、占位符位置不同）。
每种语言至少看一句带变量的文案。

## 八、风险

| 风险 | 说明 |
| --- | --- |
| **按词盲替换** | 会把 `@genoffice/` 包名和死文案一起改掉。脚本必须先出 `--dry-run` 报告 |
| **死文案被"复活"** | 把积分/账号文案换成新品牌，等于给不存在的功能做广告 |
| **`appId` 变更** | 影响桌面端签名与钥匙串历史——鸿蒙侧首发无存量用户，不涉及 |
| **上游合并冲突** | 每一处替换都是未来 cherry-pick 的冲突点。所以「不动」类要真不动 |
| **i18n 变量** | 见上 |
