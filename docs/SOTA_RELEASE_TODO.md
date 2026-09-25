# Sota Office 发布前改造 TODO

以 **Sota Office** 品牌独立发布（鸿蒙 HAP，可选桌面）前，要清掉上游 genspark 的服务与品牌残留。

> 制定 2026-09-24 | 更新 2026-09-25
> **决策依据**（为什么选 `glm`、为什么补 `bocha`）见 `SOTA_DECISIONS.md`
> 路径约定：相对 `thirdparty/genoffice/` 记作 `G/`；本仓壳工程记作 `S/`

## 剩余工作总览

三个决策（D1/D2/D3）已拍板，执行到第三阶段。**剩下的事情是这些**：

| # | 剩余项 | 章节 | 规模 / 备注 |
| --- | --- | --- | --- |
| 1 | **品牌文案批量替换** | §3 | 约 1410 处，横跨 228 个文件 × 20 语言 |
| 2 | 品牌元信息、窗口标题、About | §3.1–3.3 | appId 变更会影响钥匙串/签名链 |
| 3 | AI 面板品牌与图标 | §3.4 | 用户直接可见 |
| 4 | 外链与 Star 推广 | §3.7–3.9 | 6 个上游端点 |
| 5 | AI 品牌标识（UA、Codex 提示词、代理探测） | §2.9–2.11 | 已核实：三处都还是旧品牌 |
| 6 | 遥测文档与隐私政策同步 | §4.2、§6.3 | 与 §4.1 强绑定 |
| 7 | 自动更新模块移除 | §4.3–4.4 | 鸿蒙侧整体移除，走应用市场 |
| 8 | 字体 CDN、GenTeam 社区 | §4.5–4.6 | 换自有或删除 |
| 9 | 壳工程收尾（应用名、Ability 标签、版本号） | §5.1–5.3、5.5–5.6 | |
| 10 | 发布合规 | §6 | 需法务确认 NOTICE 措辞 |
| 11 | 未配置 AI 时的界面引导 | §9 阶段三 | 替代原来的登录引导 |
| 12 | 搜索改动里的 UI 与 i18n 部分 | §0.2 清单 | 需确认是否随阶段一一起落地了 |

进度详情见 §9。

---

## 0. 三个决策（已拍板）

| # | 问题 | 结论 |
| --- | --- | --- |
| **D1** | AI 后端走哪条路 | **纯 BYOK**，不预置自有后端；默认厂商 `glm`，`custom` 保留给自建网关 |
| **D2** | 是否保留账号体系 | **整体移除**——D1 没有自有网关，没有账号可挂 |
| **D3** | 搜索/生图/媒体解析 | 搜索删 gsk + 补国内 provider（默认 `bocha`）+ 加 custom 端点；生图与解析同为 BYOK |

论证过程、候选对比、选型硬约束（默认厂商必须在 chat ∩ media 交集内）
以及 `custom` 端点契约，都在 **`SOTA_DECISIONS.md`**。

---

## 1. 账号与身份 🟡 主体已完成

| # | 项 | 位置 | 动作 |
| --- | --- | --- | --- |
| 1.1 ✅ | 账号入口（Home 左下角头像 → 设置"账号"页） | 原 `Home.tsx` 的 `AccountEntry` 已换成 `SettingsEntry`（现 `Home.tsx:638-670`、挂载在 `:2224`）；`SettingsModal.tsx` 的 `SECTIONS` 现为 `:142-148` | 已移除 |
| 1.2 ✅ | 设备码登录全流程 | 原 `genoffice-auth.ts`（device_code→token→session→api_tokens/create）与对应 IPC | 已移除 |
| 1.3 ⬜ | **`@genspark/cli`(gsk) 依赖链** | `G/packages/ai-search/package.json:19` 仍声明 `@genspark/cli`；`electron-builder.cjs` 的 `extraResources` 仍有三处把它拷成 `gsk/node_modules/@genspark/cli` | **未做**：代码已无调用（`gsk.ts` 已删），但依赖与打包配置还在，属死依赖，安装包仍会带 gsk CLI 树 |
| 1.4 ✅ | 积分展示与用量外跳 | `gsk.ts` 已删，相关 UI 与 IPC 已移除 | 已移除 |
| 1.5 ✅ | 云项目（Genspark Projects） | `cloud-projects.ts` 已删，UI 与 IPC 已移除 | 已移除 |
| 1.6 ✅ | 登录埋点 | 随 1.1/1.2 移除 | 已移除 |
| 1.7 ⬜ | 账号文案（全语言） | `strings.ts:124-144`（`// Account` 块）、`:286`、`:304-329` | **未做**：文案一字未动，归入阶段三 i18n |
| 1.8 | 凭据落盘目录 | 已随账号链移除；仅剩 `cli-link.ts:58` 的 `~/.genoffice/launcher` | 换品牌目录 |

## 2. AI 能力与后端 🟡 主体已完成

**已完成**：2.1–2.6、2.8。
**待做**：2.7（未登录错误文案）、2.9–2.11（品牌标识，三处都还是旧品牌）。

| # | 项 | 位置 | 动作 |
| --- | --- | --- | --- |
| 2.1 ✅ | **默认 provider = genspark，且一切异常配置都回落 genspark** | `providers.ts:42-62,304-323,338-356`；`media.ts:20-34,175-191,246-263`；`search-settings.ts:8-21` | 按 D1 移除 genspark + 回退语义改为"未配置则禁用并提示" |
| 2.2 ✅ | 模型清单（硬编码上游代理模型名） | `providers.ts:44-62` + `RETIRED_MODELS` `:313,372` | 换成 BYOK 模型清单 |
| 2.3 ✅ | LLM 代理端点硬编码 | `providers.ts:9-13`；`registry.ts:146-155` | 移除；自建走 `custom` 的 baseUrl |
| 2.4 ✅ | `X-Agent-Type` 计费归属头 | `providers.ts:20-26`；注入 `protocols/anthropic.ts:140,271`、`openai-compatible.ts:158,324` | 随 2.3 移除 |
| 2.5 ✅ | 云单页幻灯片（gsk slide_generate） | `gsk.ts:339-450`；`slides-main.ts:1642-1694` | 删调用，保留本地 BYOK 路径 |
| 2.6 ✅ | 生图/媒体解析/搜索的 genspark 路由 | `media-tools.ts:29-32,73-78`、`search-tools.ts:20,40`、`index.ts:144-151,186-193` | 按 D3 处理 |
| 2.7 🟡 | 未登录错误文案（20 语言） | `docs-main.ts:200` 起；各 app `i18n/ai/*.ts` | 改"未配置 AI 后端 + 打开设置"；`errGskCli` 已改名 `errAiProviderUnset`，文案待改 |
| 2.8 ✅ | gsk 登录态门禁按钮（4 个编辑器 AI 面板） | 各 `AiPanel.tsx` + `ai:gsk-status`/`ai:gsk-login` 通道 | 随 1.2 移除 |
| **2.9** ⬜ | **AI User-Agent** | `G/packages/ai-provider/src/fetch.ts:25`（`AI_DEFAULT_USER_AGENT = 'GenOffice'`） | 改为 `SotaOffice/<version>` |
| **2.10** ⬜ | **Codex CLI 提示词自称 GenOffice** | `G/packages/ai-provider/src/codex-app-server.ts:65,376` | 换品牌，或默认隐藏该 provider |
| **2.11** ⬜ | **代理探测硬编码 genspark.ai** | `G/apps/shell/src/main/index.ts:4525`、`slides-main.ts:4651-4652` | 换自有域名或删（机制可保留） |

## 3. 品牌与文案 ⬜ 待做

**规模**：`genspark` / `Genspark` / `GenSpark` 三种写法，`apps` 下共约 **1410 处、228 个文件**（`packages` 另有 66 处 / 28 文件）：

| app | 文件数 | 提及次数 |
| --- | --- | --- |
| shell | 14 | 494 |
| docs | 73 | 323 |
| slides | 70 | 267 |
| sheets | 34 | 243 |
| html | 28 | 40 |
| markdown | 9 | 43 |

集中在约 8–10 个 key 乘 20 种语言，**适合脚本批量替换 + 抽查**。

| # | 项 | 位置 | 动作 |
| --- | --- | --- | --- |
| 3.1 | 应用元信息 | `electron-builder.cjs:235-236`（appId `com.genoffice.app`、productName）、`:496-497`、`:511,535,553`；各 app `package.json` | 换品牌（**appId 变更影响钥匙串/签名链**） |
| 3.2 | 窗口与 HTML 标题（7 处） | `index.ts:2470`；7 个 `renderer/index.html:10` | 换 |
| 3.3 | About 对话框 + 菜单标签（20 语言） | `app-menu.ts:580-591`（硬编码）、`:48,73` 及全 locale 块 | 换 |
| 3.4 | AI 面板品牌（用户直接可见） | docs `Ribbon.tsx:2857,2957`、`AiPanel.tsx:1216,1244,1248-1249`；slides `App.tsx:3290,3628-3629`；markdown `AiPanel.tsx:746-751`；图标 `GensparkMark`；`i18n/ai/*` 的 `aiPanelTitle` | 换自有 AI 品牌 + 新图标 |
| 3.5 | 字体族名（用户可见） | `GenOffice Sans/Serif/Gothic KR`、`Poppins/Che Latin KR` | 换名（注意 docx 兼容映射联动） |
| 3.6 | Logo 与图标资产 | `assets/genoffice-logo.svg`、`app-icon.png`、`build/icons/*` | 换 Sota 资产 |
| 3.7 | 外链（6 个上游端点） | `github.com/genspark-ai/genoffice`（About/Star/star 计数/更新页）、`genoffice.ai/join`、`genspark.ai/pricing` | 换自有或删除 |
| 3.8 | Star 推广机制 | `star-prompt.ts`（全文）、`StarPromptCard.tsx`、`SettingsModal.tsx:1188-1206` | 独立发布建议整体移除 |
| ~~3.9~~ | ~~Integrations 安装命令~~ | — | **作废**：集成页已随账号链整体移除；需清掉残留的测试导入（`apps/shell/tests/settings-integrations.test.ts` 仍引用已不存在的 `IntegrationsPane`） |
| 3.10 | CLI/MCP/SKILL 命名 | `skills/genoffice/SKILL.md`、`cli/src/agent-skills.ts:25`、`result.ts:149`、`commands/mcp.ts:8`、`fs.ts:37`、`cli-link.ts`、MCP 示例名 | 换品牌（技能名变更需发布迁移） |
| 3.11 | 默认保存目录 | `G/apps/shell/src/shared/home-api.ts:191`（实现落在 `packages/electron-utils/src/default-save-dir.ts`） | 换 `<Documents>/Sota Office`——**注意 shim 里的日志路径与 documents 探测路径用的是同一个目录名，要同步改** |
| 3.12 | 零散硬编码品牌 | `control-handlers.ts:45`、`NoteMargin.tsx:168,302`、`pdf-skill.ts:5`、`strings-zotero.ts` | 换 |

## 4. 遥测 · 更新 · 云 🟡 4.1 已完成

| # | 项 | 位置 | 动作 |
| --- | --- | --- | --- |
| 4.1 ✅ | GA4 匿名遥测 | `analytics.ts`（整文件，端点 `google-analytics.com/mp/collect`）；key 由 CI 注入 | 已关闭：本构建不注入 key，`initAnalytics()` 保持 no-op |
| 4.2 ⬜ | 隐私文档与遥测强绑定 | `G/PRIVACY.md:9-70`、`apps/shell/tests/privacy-doc.test.ts`（锁定测试）、`strings.ts` 的 `setAnalyticsDesc`、`Onboarding.tsx:215-226` | **4.1 改了，这些必须同步** |
| 4.3 ⬜ | **自动更新（electron-updater）** | `updater.ts`（feed 由 `GENOFFICE_UPDATE_URL` 注入；检查 15s 后 + 每 4h）、`docs/src/main/updater.ts` | 鸿蒙侧**整体移除**（须走应用市场）；桌面版换自有 URL |
| 4.4 ⬜ | 更新 UI 入口 | `SettingsModal.tsx:75-77,1170-1187`、`app-menu.ts:564-586` | 随 4.3 |
| 4.5 ⬜ | GenTeam 社区 + GitHub star 生态 | `index.ts:485,3533-3534`、`Onboarding.tsx:215`、star 计数 `index.ts:521-537` | 移除或换自有 |
| 4.6 ⬜ | 字体 CDN | `slides/src/main/font-store.ts:16-52` | 换自有 CDN 或内置字体包（sha256 校验可保留） |
| 4.7 ⬜ | 代理探测域名 | 见 2.11 | 同 |

## 5. 壳工程（HarmonyOS 侧，`S/`）🟡 5.4 已完成

| # | 项 | 位置 | 动作 |
| --- | --- | --- | --- |
| 5.1 ⬜ | 应用名 | `S/AppScope/resources/base/element/string.json`（`app_name: "GenOffice"`） | → `Sota Office` |
| 5.2 ⬜ | Ability 标签/描述 | `S/entry/src/main/resources/base/element/string.json`（7 处） | → Sota 品牌 |
| 5.3 ⬜ | 版本号 | `S/AppScope/app.json5`（`versionName: "0.1.0"`、`versionCode: 1000000`） | 定发布版本 |
| 5.4 ✅ | 应用图标 | `S/AppScope/resources/base/media/*`、`entry/.../app_icon.png` | 已换（黑底白 G，`scripts/gen-icons.py` 生成；有品牌图后重生成） |
| 5.5 ⬜ | 权限 reason 文案 | `S/web_engine/src/main/resources/{base,zh_CN,en_US}/element/string.json` | 复核措辞（上架需要） |
| 5.6 ⬜ | HAP 体积核对 | 当前约 328MB | 与商店单包上限核对；必要时裁 modules/cli |

> `vendor` 与 `app_name` 的现状在 `OPEN_ITEMS.md` 也登记了一份，那两份保持同步。

## 6. 发布合规 ⬜ 待做

| # | 项 | 位置 | 动作 |
| --- | --- | --- | --- |
| 6.1 | 许可与署名 | `G/LICENSE`（Apache-2.0）、`G/NOTICE`（`Copyright 2026 Mainfunc, Inc.`）、`LICENSE-UNICODE.txt`、`gen-third-party-notices.mjs:250` | 保留 Apache-2.0 署名义务；主体/品牌行按新主体调整；**NOTICE 措辞需法务确认** |
| 6.2 | 仓库元信息 | `G/package.json` 的 `repository/homepage`、`README`/`PRIVACY`/`CONTRIBUTING` 等 | 换 Sota 仓库与品牌 |
| 6.3 | 隐私政策 | 依赖 4.1/4.2 的最终遥测方案 | 发布前定稿（上架需要） |
| 6.4 | 第三方依赖许可审查 | `G/tools/check-licenses.mjs`（构建期门禁） | 保留门禁 |
| 6.5 | 内置字体许可 | `apps/docs/src/renderer/fonts/*.woff2` | 核对授权（随 3.5 改名一并确认） |

## 7. 可保留（仅需知晓，不阻塞）

- **BYOK provider 目录**（15+ 厂商）：按目标市场裁剪即可，架构保留
- **免费搜索兜底链**（Serper→Tavily→DuckDuckGo）+ 本地媒体加载
- **MCP 本地服务器**、**CLI**、**项目/聊天历史存储**（纯本地，无外连）
- **Codex CLI 集成**（登录属 OpenAI，与本仓无关；提示词换品牌即可，见 2.10）
- `@genoffice/*` workspace 包名与 import 路径（内部标识不可见；改名成本极高，建议不动）
- 代码注释里的上游 issue 引用、`ee/` 空壳、CI 发布脚本（可复用于自有 CDN）

## 8. 建议实施顺序

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| 0 | 拍板 D1/D2/D3 | ✅ 2026-09-24 |
| 1 | 第 2 章（AI 后端与模型） | ✅ 已完成 |
| 2 | 第 1 章（账号与身份） | 🟡 主体完成，剩 gsk 死依赖与账号文案 |
| 3 | 第 3 章（品牌与文案，i18n 脚本化）+ 2.9–2.11 + UI 引导 | ⬜ **当前阶段** |
| 4 | 第 4 章（遥测/更新） | ⬜ |
| 5 | 第 5 章（壳工程） | ⬜ |
| 6 | 第 6 章（合规）+ 真机整体回归 | ⬜ |

**风险提示**：

1. `appId` 变更会影响桌面端的签名与钥匙串历史。
2. `@genspark/cli` 移除后云能力全部消失——D1/D3 的替代方案已就绪，确认无误再删。
3. i18n 批量替换后必须**抽查各语言**，尤其含变量的句子。
4. 鸿蒙侧移除更新模块前，确认应用市场的自动更新链路可用。

---

## 9. 实施进度

### 阶段一：核心逻辑层（已完成）

分支 `ohos/sota-debrand`（genoffice 仓），35 文件 +460/-706。

- **ai-provider**：去 `genspark` provider / 端点 / 归属头 / 兜底；默认厂商切 `glm`（chat 1 处 + media 3 处）；
  `activeProvider` / `activeMediaProvider` 改**可空**（无有效配置返回 null，不再静默打向上游）；
  删 `gskToolsEnabled` 与 `cloudToolsEnabled()`；可用性谓词去掉 gsk 参数
- **搜索**：链切 `custom → bocha → serper → tavily → DuckDuckGo`（墙外三家按要求保留）；
  新增 `bochaWebSearch`（api.bochaai.com）与 `customWebSearch`（兼容 SearXNG JSON 与极简契约）；
  provider 目录 `bocha/serper/tavily/custom`，默认 `bocha`
- **apps / cli**：3 处 `ai:get-settings` 适配可空；5 处媒体谓词调用去 gsk 参数；
  docs 的 `gskToolsEnabled` 修复逻辑与 4 处 genspark 分支清理；cli `capabilities` 去 gsk

**验证**：ai-provider 18 文件 / 225 测试通过；ai-search 4 文件 / 56 测试通过；
全量 typecheck 仅剩下面那条既有问题。

**已知问题（基线即有，非本次引入）**：`packages/html2docx/src/convert.ts:317` TS2769。
把改动全部 stash 后在基线 `339470d` 上能复现**同一个错误**；不阻塞构建（`build:all` 不含 typecheck）。

### 阶段二：账号链移除（已完成主体）

**删除**：

- `packages/ai-search/src/gsk.ts`（619 行：gsk 搜索/生图/幻灯片/云项目/登录态全套）
- `packages/ai-search/src/genoffice-auth.ts`（421 行：设备码登录全流程）
- `apps/shell/src/main/cloud-projects.ts`，以及 gsk / genoffice-auth / cloud-projects 三个测试文件

**清除**：

- **shell**：账号 IPC（`accountStatus`/`Login`/`LoginOpenUrl`/`Logout`）、credits 外跳与余额、
  云项目 IPC 与缓存；`home-api.ts` 的对应类型与 channel；preload 实现
- **slides / sheets / docs**：各自的 `ai:gsk-status` / `ai:gsk-login` handler
- **slides**：云单页幻灯片（`slides:cloud-page-generate` 全套）；
  **保留**本地 BYOK 生成路径（`slides:local-page-generate`）
- **5 个 app 的 AI 面板**：`gskLoggedInRef` 门禁（实测只写不读）与登录按钮已清除；
  `loginRequired` 死 prop 仍留在 3 处（`docs/AiPanel.tsx:100`、`sheets/AiChatPanel.tsx:203`、
  `slides/AiPanel.tsx:251`，只声明不使用），待删

**改造**：

- `Home.tsx`：左下角**账号入口 → 设置入口**（原设计里设置弹窗只从账号入口打开，故不能直删）
- `SettingsModal.tsx`：删账号页与 8 个账号 props，默认落 **AI 模型页**
- `media-tools.ts`：媒体工具改**纯 BYOK**，未配置时返回 `MEDIA_NOT_CONFIGURED_ERROR`；
  `GSK_RMBG_MODEL` 与透明背景的二次抠图链随 gsk 一并移除
- 代理函数改名 `setGskProxyUrl` / `gskProxyUrl` → `setAiProxyUrl` / `aiProxyUrl`（消费方 4 处）

**验证**：全量 typecheck 仅剩既有 `html2docx:317`；`npm run build:all` **通过**；
ai-search 20 测试通过（media-tools 测试重写为 BYOK 语义）。

### 阶段三（进行中）

- **i18n 品牌文案**（§3）：各 app 的 `aiGskLoginBtn` 等 gsk 文案（60 个文件）、
  slides 的 `errGskNotLoggedIn`（`errGskCli` 已改名 `errAiProviderUnset`，文案待改）、
  以及上表统计的 1410 处 genspark 提及
- **shared/ipc 与 preload 的类型残留**：`ai:gsk-status` channel 常量、
  `GenSparkAccountStatus` 类型（现无 main handler，调用会 reject）
- **AI 品牌标识**：§2.9–2.11 三处
- **UI 面板引导**：未配置 AI 时给"去设置配置模型服务"提示（替代原登录引导）
