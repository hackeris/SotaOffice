# Sota Office 发布前改造 TODO(仅规划,不执行)

> 制定:2026-09-24 | 依据:GenOffice 代码四维度扫描(账号/鉴权 · AI/模型 · 品牌/文案 · 遥测/更新/云)
> 范围:以 **Sota Office** 品牌独立发布(鸿蒙 HAP + 可选桌面)——清掉上游 genspark 服务与品牌残留
> 位置约定:路径相对 `thirdparty/genoffice/`(记作 `G/`);本仓壳工程记作 `S/`
> **本文件只规划,不动代码**

---

## 0. 三个待决策问题(先拍板,决定后面范围)

| # | 问题 | 选项 | 影响面 |
|---|---|---|---|
| **D1** | **AI 后端走哪条路** | ✅ **已定:纯 BYOK**(2026-09-24 用户决定:无自有网关)。AI 能力全部走用户自备 key;**默认厂商 `glm`**(2026-09-24);`custom` provider 保留,供有网关的用户自填 OpenAI 兼容端点 | 决定第 1、2 章范围与"是否保留登录" |
| **D2** | **是否保留账号体系** | ✅ **已定(2026-09-24):整体移除**——D1 为纯 BYOK 且无自有网关,没有账号可挂(登录 UI / IPC / 凭据 / credits / 云项目全清) | 第 1 章 |
| **D3** | **搜索/生图/媒体解析怎么办** | ✅ **已定(2026-09-24)**:搜索 = 删 gsk + **补国内 provider(默认 `bocha`)** + **加 custom 端点**,墙外服务(Serper / Tavily / DuckDuckGo)保留;生图 / 媒体解析 = 纯 BYOK(默认同 D1 = `glm`) | 第 2 章尾部 |

**现状关键事实**(便于判断):未登录**不阻塞**本地编辑/转换/OCR/MCP/CLI——受影响的只有云端 AI 能力。

---

## 0.1 D1 落地方案(AI 后端)

**代码现状(决定方案形状)**:
- `custom` provider 已是**完整的 OpenAI 兼容通道**——`G/packages/ai-provider/src/registry.ts:266-277`:要求 `config.baseUrl`,协议 `openai-compatible`,支持 vision,**写新代码为零**
- provider 目录已有 15+ 家 BYOK 厂商;genspark 的特殊点是 `auth: 'gsk-login'`(不要 key,靠登录态)与其模型清单是**代理服务端的模型池**(`providers.ts:44-62` 七个名字)

**方案(唯一):纯 BYOK,不预置任何后端。** 这带来两个连带结论:
- AI 面板定位 = **"配置后可用"**:未配置时给**配置引导**(打开设置选厂商/填 key),而不是登录引导
- 账号体系失去存在意义(D2 顺势定为**移除**)→ 第 1 章全量执行

**默认 provider:✅ 已定 `glm`(智谱)**(2026-09-24 用户拍板)。

**选型硬约束**:默认厂商必须**同时存在于两套目录**(chat 的 `AI_PROVIDERS` × media 的 `AI_MEDIA_PROVIDERS`),
否则会出现"对话能用、生图不通"。两边**都有的 id**:`openai` `gemini` `doubao` `glm` `qwen` `xai` `minimax` `custom`;
其中 `minimax` 在 media 侧**无 analysisModels**(只能生图不能解析);`deepseek`/`kimi`/`anthropic`/`mistral` 等**只在 chat 侧**。

> **现状说明**:三处默认值当前**已经统一**为 `genspark`——改造时须**一并替换为同一新厂商**,不可只改一处(它们是三套独立目录,最易漏改)。

| 候选 | 两侧模型 | 适合 |
|---|---|---|
| ✅ **`glm`**(智谱) | 生图 `cogview-4/3-flash`;解析 `glm-4.6v/4.6v-flash` | **已选默认**(2026-09-24) |
| `qwen`(通义) | 生图 `qwen-image-plus/image`;解析 `qwen3-vl-plus/flash` | 国内备选 |
| `doubao`(豆包) | 生图 `doubao-seedream-5-0/4-5`;解析 `doubao-seed-2-1-pro/turbo` | 国内备选 |
| `openai` / `gemini` | GPT Image / Gemini Image + 各自视觉模型 | 海外场景 |
| `custom` | **两套目录均有**(模型由用户填) | 自带网关/自建端点用户 |

> 已选 `glm`:设置页保留全部 BYOK 厂商 + `custom`(供自带网关/自建端点的用户覆盖,两侧都能配),用户可随时改选。

**要做的代码改动**:
1. `providers.ts:304-323` `defaultAiSettings()`:`provider: 'genspark'` → `'glm'`;media 侧 `media.ts` 三个默认值(image/analysis/videoAnalysis)**同步改 `'glm'`**
2. `providers.ts:338-356` `activeProvider()`:**删两处 `return 'genspark'` 兜底** → 无有效配置时返回空,UI 提示"未配置模型服务"(这是"静默打向上游"的根)
3. `providers.ts:42-62` 删 genspark meta(含 7 个代理模型名);`registry.ts:140-155` 删 genspark 适配器
4. `providers.ts:9-26` 删 `GENSPARK_LLM_BASE_URLS`、`GENSPARK_AGENT_TYPE`、`gensparkAttributionHeaders`
5. `providers.ts:378-383` 删 `RETIRED_MODELS.genspark` + `AiProviderId` 类型里的 `'genspark'`
6. 各编辑器 AI 面板的 `gsk-status`/`gsk-login` 门禁 → 改"未配置 → 去设置"提示(见 §1.2 / §2.8)

**BYOK 的用户侧约束**(写进帮助/首次引导即可,代码层已由 `capabilities.vision` 标注):
- 所选**模型**需支持 **vision**(文档截图/图片分析)与 **tool call**(AI 面板动作),否则相关功能不可用
- 流式由 `openai-compatible` / `anthropic` 协议实现,**任何 OpenAI 兼容端点都满足**
- ⚠ 原实现给 claude 特意走 anthropic 协议**保图片保真**(`registry.ts:146-155`);若用户用 OpenAI 兼容端点跑 claude 系模型,保真度略降——可在帮助里提示"anthropic 原生 key 效果更好"

## 0.2 D3 落地方案(搜索 / 生图 / 媒体解析)

**搜索——删上游分支 + 补国内后端(2026-09-24 决策)**:

- **现状链**(`G/packages/ai-search/src/index.ts:141-172`):gsk(登录态) → Serper → Tavily → **DuckDuckGo**(无需 key,抓 `html.duckduckgo.com` HTML) → 失败返回 `method:'error'`。provider 目录在 `G/packages/ai-provider/src/search-settings.ts:8-14`(**不在 ai-search 包内**,仅三家 `genspark`/`serper`/`tavily`)
- ⚠ **国内可用性事实**:链上三级(Serper `google.serper.dev`、Tavily、DuckDuckGo)**均无法国内直连**;DuckDuckGo 还是 HTML 抓取且超时 `FALLBACK_TIMEOUT_MS=5000`。故"删 gsk 即零后端可用"**对国内不成立**——不补后端时的表现是"点搜索等 5 秒后失败"
- **决策**:①删 gsk 分支 ②**补一家国内搜索 provider**(下以 **博查 Bocha** 为例)③**加 `custom` 搜索端点**(自建 SearXNG 等)④**墙外服务 Serper/Tavily/DuckDuckGo 全部保留**

改动清单(自下而上五层;用户自填 key 的通路**已存在**——`search-tools.ts` 的 `testSearchProvider` 即设置页"测试"按钮,无需新建 IPC):

| 层 | 位置 | 改动 |
|---|---|---|
| 类型 | `G/packages/ai-provider/src/types.ts:108` | `AiSearchProviderId` 删 `'genspark'`,加 `'bocha' \| 'custom'` |
| 类型 | 同上 `:110-116` | `AiSearchProviderMeta` 加 `baseUrlPlaceholder?: string`(custom 用) |
| 类型 | 同上 `:120` | `providers` 值类型加 `baseUrl?: string`(custom 用) |
| 目录 | `G/packages/ai-provider/src/search-settings.ts:8-14` | `AI_SEARCH_PROVIDERS` 删 genspark 项,加 bocha / custom 两项 |
| 目录 | 同上 `:17-19` | `defaultAiSearchSettings()` 默认 `provider` 由 `'genspark'` 改新默认(见"待定") |
| 目录 | 同上 `:35-44` | `activeSearchProvider()` **删两处 `return 'genspark'` 回落** → 无 key / 未知 id 返回"无搜索"(与 §0.1 第 2 条同病同治) |
| 实现 | `G/packages/ai-search/src/index.ts` | 新增 `bochaWebSearch()`:`POST https://api.bochaai.com/v1/web-search`,`Authorization: Bearer <key>`,body `{query, count, summary:false}`,解析 `data.webPages.value[]` → `{title:name, url, snippet}` |
| 实现 | 同上 | 新增 `customWebSearch()`:请求用户填的 baseUrl,解析契约见下 |
| 实现 | 同上 `:145-172` | `webSearch()` 删 gsk 分支;候选链接入 bocha / custom |
| 实现 | 同上 `:181-233` | `imageSearch()` 同链同改 |
| 桥接 | `G/packages/ai-search/src/search-tools.ts:19-27` | `searchOptionsFromSettings()` 加 bocha / custom 分支(custom 须连 baseUrl 一并传入) |
| 桥接 | 同上 `:38-56` | `testSearchProvider()` 加同样分支 |
| UI | `G/apps/shell/src/renderer/src/SettingsModal.tsx:869-895` | 提示文案**硬编码了三分支**(`genspark` / `imageSearch` / 其他)→ 改按目录 meta 驱动;custom 增 baseUrl 输入框 |
| UI | 同上 `:658-668` | "测试"调用补 baseUrl 参数 |
| i18n | 各语言 `strings.ts` | 新增 bocha / custom 的 label 与提示 |

**国内后端选型**:博查 Web Search(`api.bochaai.com/v1/web-search`,POST)——国内直连、响应约 1s、约 ¥0.036/次,响应格式**兼容 Bing Search API**。备选:**智谱 Web Search API**——若 §0.1 的默认 AI 厂商选 `glm`,可与对话/生图**复用同一个 key**(少一次注册),选型时一并权衡。

**`custom` 端点契约**(建议兼容两种,同一解析器可吃掉,实现成本相同):
- **SearXNG JSON**:`{results:[{title, url, content}]}`(自建最常见)
- **极简契约**:`{results:[{title, url, snippet}]}`

**默认值(✅ 已定 2026-09-24)**:
1. **默认 provider = `bocha`**(博查,国内直连)。注:此项只决定设置页下拉初值——**无 key 时任何 provider 都产生不了可用后端**,真正要紧的是"未配置时给配置引导,而非静默失败"(同 §0.1)
2. **`custom` 的图片搜索 = `false`**(`AiSearchProviderMeta.imageSearch` 是静态布尔,自定义端点无法预知;图片搜索仍走 DuckDuckGo 兜底)

> **备选记录**(非当前方案):搜索后端若改用**智谱 Web Search API**,可与 §0.1 已定的 AI 厂商 `glm` **复用同一个 key**(一个 key 覆盖对话/生图/解析/搜索)。当前选择是 `glm` + `bocha`(用户需注册两家),此备选留待后续权衡。

**生图 / 媒体解析——同为 BYOK**:
- 现状:`media.ts` 的 `AI_MEDIA_PROVIDERS` 首项为 genspark;`defaultAiMediaSettings()` 的 image/analysis/videoAnalysis **三个默认值全是 genspark**,与 chat 侧一致
- **现成 BYOK 通路**(media 侧 id 与模型,均已配好):`openai`(gpt-image-* / gpt-5.6-*,两侧齐)· `gemini`(gemini-3*-image / gemini-3*)· `doubao`(seedream-5-0/4-5 / seed-2-1-pro/turbo)· `glm`(cogview-4/3-flash / glm-4.6v)· `xai`(grok-imagine / grok-4.6)· `qwen`(qwen-image-plus / qwen3-vl-plus)· `minimax`(image-01,**无解析模型**)· `custom`(模型用户填)
- 改动:删 genspark 项;**三个默认值一并换成与 D1 同一个厂商**(须在 chat ∩ media 交集内,见 §0.1)
- 未配 key 时:生图/解析入口给**配置引导**,不得报错或静默失败

**工作量**:搜索 **2–2.5 人日**(原估 0.5 仅算"删";新增两个 provider + 类型/UI 字段后上调);生图/媒体 1–2;D1 主体 2–4(含回退逻辑重写与各面板提示)。

---

## 1. 账号与身份(阻塞发布)

| # | 项 | 位置 | 动作 |
|---|---|---|---|
| 1.1 | 账号入口(Home 左下角头像 → 设置"账号"页) | `G/apps/shell/src/renderer/src/Home.tsx:644-850`(`AccountEntry`)、`SettingsModal.tsx:1122-1169`、`:141,144`(section 定义) | 移除或换自有 |
| 1.2 | 设备码登录全流程 | `G/packages/ai-search/src/genoffice-auth.ts`(全文:device_code→token→session→api_tokens/create,`app_type=genoffice`、baseUrl 硬编码 `www.genspark.ai`)、IPC `G/apps/shell/src/main/index.ts:3182-3227` | 移除;若做自有登录需整套重写 |
| 1.3 | **`@genspark/cli`(gsk)依赖链** | `G/packages/ai-search/src/gsk.ts:38-55,86-107`;`G/packages/ai-search/package.json:19`;打包 `G/apps/shell/electron-builder.cjs:301` | **移除依赖+打包配置**;`gskApiKey` 第三级回落(`~/.genspark-tool-cli/config.json`,静默复用用户本机 gsk 登录=计费身份错乱)必删 |
| 1.4 | 积分(credits)展示与用量外跳 | `G/apps/shell/src/main/index.ts:565-567,3677`(`CREDIT_USAGE_URL`);`SettingsModal.tsx:1126-1144`;余额源 `G/packages/ai-search/src/gsk.ts:604-619` | 移除;`errorCode:'credits'` 分类通道可保留给自有后端 |
| 1.5 | 云项目(Genspark Projects) | `G/apps/shell/src/main/cloud-projects.ts`(全文)、UI `Home.tsx:969-1134`、IPC `index.ts:3725-3733`、缓存 `userData/cloud-projects.json` | 整体移除(数据/跳转域名均属上游) |
| 1.6 | 登录埋点 | `G/apps/shell/src/main/index.ts:3195,3212`(`login_click`/`login_success`) | 随 1.1/1.2 移除 |
| 1.7 | 账号文案(全语言) | `G/apps/shell/src/renderer/src/strings.ts:124-144,286,304-329`(accountGenspark/loginGenspark/credits…) | 移除或换词 |
| 1.8 | 凭据落盘目录 | `~/.genoffice/auth.json`(0600)、`~/.genoffice/bin/` | 若保留自有登录,换品牌目录名(`~/.sota-office/`)并考虑升级到系统凭据库 |

---

## 2. AI 能力与后端(阻塞发布)

| # | 项 | 位置 | 动作 |
|---|---|---|---|
| 2.1 | **默认 provider = genspark,且一切异常配置都回落 genspark** | `G/packages/ai-provider/src/providers.ts:42-62,304-323,338-356`;媒体侧 `media.ts:20-34,175-191,246-263`;搜索侧 `search-settings.ts:8-21` | 按 D1:移除 genspark 项 + 改回退语义为"未配置则禁用 AI 并提示" |
| 2.2 | 模型清单(硬编码上游代理模型名) | `G/packages/ai-provider/src/providers.ts:44-62`(`claude-opus-4-7/4-8`、`gpt-6-astra`、`gpt-5.6-*`、`deep-seek-v4.1-flash`)+ `RETIRED_MODELS` 迁移表 `:378-383` | 换成自建/BYOK 的模型清单 |
| 2.3 | LLM 代理端点硬编码 | `G/packages/ai-provider/src/providers.ts:9-13`(`/api/anthropic`、`/api/llm_proxy/v1`);`registry.ts:146-155`(genspark 适配器忽略 `config.baseUrl`) | 移除;自建走 `custom` provider 的 baseUrl |
| 2.4 | `X-Agent-Type: genoffice` 计费归属头 | `G/packages/ai-provider/src/providers.ts:20-26`;注入 `protocols/anthropic.ts:140,271`、`openai-compatible.ts:158,324` | 随 2.3 移除 |
| 2.5 | 云单页幻灯片(gsk slide_generate) | `G/packages/ai-search/src/gsk.ts:339-450`;`G/apps/slides/src/main/slides-main.ts:1642-1694` | 已有 kill switch `GENOFFICE_CLOUD_SLIDE=0` 可先降级;终态删调用 |
| 2.6 | 生图/媒体解析/搜索的 genspark 路由 | `G/packages/ai-search/src/media-tools.ts:29-32,73-78`、`search-tools.ts:20,40`、`index.ts:144-151,186-193` | 按 D3 处理 |
| 2.7 | 未登录错误文案(21 语言) | `G/apps/docs/src/main/docs-main.ts:204` 起(`errGskNotLoggedIn`);各 app `i18n/ai/*.ts` 的 `aiGskLoginBtn/aiNotLoggedIn/aiCreditsExhausted` | 改为"未配置 AI 后端/API key + 打开设置" |
| 2.8 | gsk 登录态门禁按钮(4 个编辑器 AI 面板) | docs/slides/markdown/html 的 `AiPanel.tsx` + `ai:gsk-status`/`ai:gsk-login` 通道(`docs-main.ts:2895-2910`、`ai-ipc.ts:118-131`) | 随 1.2 移除 |
| 2.9 | AI User-Agent | `G/packages/ai-provider/src/fetch.ts:25`、`docs-main.ts:3298`、`ai-ipc.ts:108` 等 | `SotaOffice/<version>` |
| 2.10 | Codex CLI provider 提示词自称 GenOffice | `G/packages/ai-provider/src/codex-app-server.ts:64-65` | 换品牌 / 默认隐藏该 provider |
| 2.11 | 代理探测硬编码 genspark.ai | `G/apps/shell/src/main/index.ts:4665-4690`、`slides-main.ts:4678-4706` | 换自有域名或删(机制可保留) |

---

## 3. 品牌与文案(阻塞发布)

**规模**:i18n 中 `genspark` 出现 **793 次**,但集中在约 8-10 个 key × 22 语言(6 个 app),**适合脚本批量替换 + 抽查**。

| # | 项 | 位置 | 动作 |
|---|---|---|---|
| 3.1 | 应用元信息 | `G/apps/shell/electron-builder.cjs:235-236`(`appId: com.genoffice.app`、`productName: GenOffice`)、`:496-497`(deb 维护者 `Mainfunc, Inc. <team@genspark.ai>`)、`:511,535,553`(executableName/packageName)、各 app `package.json` 的 name/productName/author/homepage | 换 Sota 品牌(注意 appId 变更影响钥匙串/签名链) |
| 3.2 | 窗口与 HTML 标题(7 处) | `G/apps/shell/src/main/index.ts:2552`;7 个 `src/renderer/index.html:10` | 换 |
| 3.3 | About 对话框 + 菜单标签(21 语言) | `G/packages/electron-utils/src/app-menu.ts:580-591`(硬编码)、`:48,73` 及全 locale 块 | 换 |
| 3.4 | AI 面板品牌(用户直接可见) | docs `Ribbon.tsx:2857,2957`、`AiPanel.tsx:1252,1284`;slides `App.tsx:3290,3628-3629`;markdown `AiPanel.tsx:765-770`;图标 `GensparkMark`(`icons.tsx:1745-1747`、`slides/icons.tsx:2130`);`i18n/ai/*` 的 `aiPanelTitle: 'Genspark'` | 换"自有 AI 品牌"+新图标 |
| 3.5 | 字体族名(用户可见) | `GenOffice Sans/Serif/Gothic KR`、`Poppins/Che Latin KR`(`tools/gen-third-party-notices.mjs:326-351`、`apps/docs/src/renderer/fonts/`、`line-metrics.ts:610-613`) | 换名(注意 docx 兼容映射联动) |
| 3.6 | Logo 与图标资产 | `apps/shell/src/renderer/src/assets/genoffice-logo.svg`、`app-icon.png`、`build/icons/*`(8 尺寸+icns/ico)、各 app 图标 | 换 Sota 资产 |
| 3.7 | 外链(6 个上游端点) | `github.com/genspark-ai/genoffice`(About/Star/star计数 API/更新下载页 `github-menu.ts:2`、`index.ts:604,3684`、`updater.ts:394`)、`genoffice.ai/join`(Onboarding `index.ts:563`)、`genspark.ai/pricing`(i18n 充值文案) | 换自有仓库/社区,或删除 |
| 3.8 | Star 推广机制 | `G/apps/shell/src/main/star-prompt.ts`(全文)、`StarPromptCard.tsx`、`SettingsModal.tsx:1345-1360` | 独立发布建议整体移除 |
| 3.9 | Integrations 安装命令 | `G/apps/shell/src/renderer/src/IntegrationsPane.tsx:30`(`npx skills add genspark-ai/genoffice`) + 测试断言 | 换 Sota 仓库 |
| 3.10 | CLI/MCP/SKILL 命名 | `G/skills/genoffice/SKILL.md`、`packages/cli/src/agent-skills.ts:25`(`SKILL_NAME`)、`result.ts:149`(错误前缀)、`commands/mcp.ts:8`、`fs.ts:37`(`GENOFFICE_ALLOWED_ROOTS`)、`cli-link.ts`(`~/.genoffice/launcher`)、MCP 示例名 `genoffice-editor` | 换品牌(技能名变更需发布迁移) |
| 3.11 | 默认保存目录 | `G/apps/shell/src/shared/home-api.ts:205`(`<Documents>/GenOffice`) | 换 `<Documents>/Sota Office` |
| 3.12 | 零散硬编码品牌 | `control-handlers.ts:45`(错误消息)、`NoteMargin.tsx:168,302`(注释作者)、`pdf-skill.ts:5`(system prompt)、`strings-zotero.ts` | 换 |

---

## 4. 遥测 · 更新 · 云(阻塞/建议)

| # | 项 | 位置 | 动作 |
|---|---|---|---|
| 4.1 | **GA4 匿名遥测(打包版默认开)** | `G/apps/shell/src/main/analytics.ts`(整文件,端点 `google-analytics.com/mp/collect`);key 由 CI 注入(`electron-builder.cjs:46-48,627-632`)→ 源码构建天然 no-op;开关 `SettingsModal.tsx:1294-1313` | 鸿蒙/自有发布**不注入自有 key 即自动禁用**;若要数据需配自有统计 |
| 4.2 | 隐私文档与遥测强绑定 | `G/PRIVACY.md:9-70`、`apps/shell/tests/privacy-doc.test.ts`(锁定测试)、`strings.ts` 19 语言 `setAnalyticsDesc`、`Onboarding.tsx:215-226` | 4.1 一旦改动,这些**必须同步** |
| 4.3 | **自动更新(electron-updater)** | `G/apps/shell/src/main/updater.ts`(feed 由 `GENOFFICE_UPDATE_URL` 注入;`DOWNLOAD_PAGE_URL` 指向上游 releases;检查 15s 后 + 每 4h)、`docs/src/main/updater.ts` | **鸿蒙侧整体移除**(须走应用市场);桌面版换自有 URL |
| 4.4 | 更新 UI 入口 | `SettingsModal.tsx:78,1328-1341`(stable/beta 通道)、`app-menu.ts:564-586`(About 的检查更新) | 随 4.3 |
| 4.5 | GenTeam 社区 + GitHub star 生态 | `index.ts:561-563,3672`、`Onboarding.tsx:226`、star 计数 `index.ts:601-617` | 移除或换自有 |
| 4.6 | 字体 CDN | `G/apps/slides/src/main/font-store.ts:16-52`(baseUrl 由 CI 注入 `genofficeFontCdn`) | 换自有 CDN 或内置字体包(sha256 校验机制可保留) |
| 4.7 | 代理探测域名 | 见 2.11 | 同 |

---

## 5. 壳工程(HarmonyOS 侧,`S/`)

| # | 项 | 位置 | 动作 |
|---|---|---|---|
| 5.1 | 应用名 | `S/AppScope/resources/base/element/string.json`(`app_name: "GenOffice"`) | → `Sota Office` |
| 5.2 | Ability 标签/描述 | `S/entry/src/main/resources/base/element/string.json`(EntryAbility_label 等 6 处) | → Sota 品牌 |
| 5.3 | 版本号 | `S/AppScope/app.json5`(`versionName: "0.1.0"`、`versionCode: 1000000`) | 定发布版本 |
| 5.4 | 应用图标 | `S/AppScope/resources/base/media/*`、`S/entry/.../app_icon.png` | ✅ 已换(黑底白 G;`scripts/gen-icons.py`,待品牌图后重生成) |
| 5.5 | 权限 reason 文案 | `S/web_engine/src/main/resources/{base,zh_CN,en_US}/element/string.json` | 复核措辞(上架需要) |
| 5.6 | HAP 体积核对 | 当前 **328MB** | 与商店单包上限核对;必要时裁 modules/cli |

---

## 6. 发布合规(建议)

| # | 项 | 位置 | 动作 |
|---|---|---|---|
| 6.1 | 许可与署名 | `G/LICENSE`(Apache-2.0)、`G/NOTICE`(`Copyright 2026 Mainfunc, Inc.`)、`G/LICENSE-UNICODE.txt`、`tools/gen-third-party-notices.mjs:250`(包内声明头) | 保留 Apache-2.0 署名义务;主体/品牌行按新主体调整;**需法务确认 fork 发布的 NOTICE 措辞** |
| 6.2 | 仓库元信息 | `G/package.json` 的 `repository/homepage`、`G/README/PRIVACY/CONTRIBUTING/CODE_OF_CONDUCT/SECURITY.md` | 换 Sota 仓库与品牌(开源门面) |
| 6.3 | 隐私政策 | 依赖 4.1/4.2 的最终遥测方案 | 发布前定稿(鸿蒙上架需要) |
| 6.4 | 第三方依赖许可审查 | `G/tools/check-licenses.mjs`(构建期门禁,含 `@univerjs/telemetry` 例外) | 保留门禁;若有自有发行要求再收紧 |
| 6.5 | 内置字体许可 | `apps/docs/src/renderer/fonts/*.woff2`(GenOffice Sans 等) | 核对字体授权(随 3.5 改名时一并确认) |

---

## 7. 可保留(仅需知晓,不阻塞)

- **BYOK provider 目录**(15+ 厂商:anthropic/openai/gemini/deepseek/kimi/glm/qwen/doubao/minimax/xai/mistral/openrouter…):按目标市场裁剪即可,架构保留
- **免费搜索兜底链**(Serper→Tavily→DuckDuckGo,无 key 可用)+ 本地媒体加载
- **MCP 本地服务器**、**CLI**、**项目/聊天历史存储**(纯本地,无外连)
- **Codex CLI 集成**(登录属 OpenAI,与本仓无关;提示词换品牌即可)
- `@genoffice/*` workspace 包名与 import 路径(内部标识,不可见;改名成本极高,建议不动)
- 代码注释里的上游 issue 引用、`ee/` 空壳、CI 发布脚本(`scripts/update-feed-utils.cjs` 等,可复用于自有 CDN)

---

## 8. 建议实施顺序与粗估

| 阶段 | 内容 | 依赖 | 粗估 |
|---|---|---|---|
| 0 | **拍板 D1/D2/D3** | — | — |
| 1 | 第 1 章(账号与身份,按 D2 定范围) | 阶段 0 | 2-4 人日 |
| 2 | 第 2 章(AI 后端与模型,按 D1/D3) | 阶段 0 | 4-8 人日(自建网关取上限) |
| 3 | 第 3 章(品牌与文案;**i18n 793 处脚本化**) | 可与 1/2 并行 | 3-5 人日 |
| 4 | 第 4 章(遥测/更新) | 4.1↔4.2 强绑定 | 2-3 人日 |
| 5 | 第 5 章(壳工程) | 阶段 3 | 1-2 人日 |
| 6 | 第 6 章(合规)+ 真机整体回归 | 全部 | 2-3 人日 |

**风险提示**:①`appId` 变更影响桌面签名/钥匙串历史;②`@genspark/cli` 移除后云能力全部消失,须先确认 D1/D3 的替代方案就绪;③i18n 批量替换后必须抽查各语言(尤其含变量的句子);④鸿蒙侧移除更新模块前确认应用市场自动更新链路可用。

---

## 附:四维度扫描原始结论要点

- **账号**:本地编辑零阻塞;受影响的仅云端 AI(聊天默认路由/云项目/云幻灯片/搜索/生图/媒体解析/积分)
- **AI**:默认与兜底 provider 均为 genspark;LLM 代理无 env 覆盖;`custom` provider 是唯一可指向自建的正式通道
- **品牌**:用户可见面集中在 shell + electron-utils + cli;外链 6 个端点;i18n 提及 793 次但 key 集中
- **遥测/更新**:无 Sentry/无远程配置/无运行时许可校验;更新器在鸿蒙不可用须整体移除
