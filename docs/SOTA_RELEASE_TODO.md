# Sota Office 发布前改造 TODO(仅规划,不执行)

> 制定:2026-09-24 | 依据:GenOffice 代码四维度扫描(账号/鉴权 · AI/模型 · 品牌/文案 · 遥测/更新/云)
> 范围:以 **Sota Office** 品牌独立发布(鸿蒙 HAP + 可选桌面)——清掉上游 genspark 服务与品牌残留
> 位置约定:路径相对 `thirdparty/genoffice/`(记作 `G/`);本仓壳工程记作 `S/`
> **本文件只规划,不动代码**

---

## 0. 三个待决策问题(先拍板,决定后面范围)

| # | 问题 | 选项 | 影响面 |
|---|---|---|---|
| **D1** | **AI 后端走哪条路** | ①**纯 BYOK**(用户自填 key,走已有 `custom` provider:OpenAI 兼容 baseUrl+model)②自建网关 ③继续用 genspark(与独立品牌矛盾) | 决定第 1、2 章范围与"是否保留登录" |
| **D2** | **是否保留账号体系** | 若 D1=① 或 ②,无自有账号 → **整体移除**(登录 UI/IPC/凭据/credits/云项目) | 第 1 章 |
| **D3** | **搜索/生图/媒体解析怎么办** | ①保留免费兜底(DuckDuckGo 无 key 可用)+ BYOK ②自建 ③移除 | 第 2 章尾部 |

**现状关键事实**(便于判断):未登录**不阻塞**本地编辑/转换/OCR/MCP/CLI——受影响的只有云端 AI 能力。

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
