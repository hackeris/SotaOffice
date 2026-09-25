# Sota Office 发布改造决策记录

这里记录发布前改造的三个关键决策——为什么这么选、候选有哪些、有什么约束。
**要执行的清单在 `SOTA_RELEASE_TODO.md`**，本文只讲决策本身。

> 制定 2026-09-24 | 依据：代码四维度扫描（账号/鉴权 · AI/模型 · 品牌/文案 · 遥测/更新/云）

## 前提事实

**未登录不阻塞本地能力**——编辑、格式转换、OCR、MCP、CLI 都能用，
受影响的只有云端 AI（聊天、云项目、云幻灯片、搜索、生图、媒体解析、积分）。

这一条决定了下面三个决策的腾挪空间：砍掉云端能力不会伤及产品主体。

## D1：AI 后端走纯 BYOK

**决策**：不预置任何自有后端，AI 能力全部走用户自备的 key。
默认厂商 **`glm`**（智谱）；`custom` provider 保留，给有自建网关的用户填 OpenAI 兼容端点。

**为什么**：`custom` provider 本身就已经是完整的 OpenAI 兼容通道——
要求填 `baseUrl`、协议是 `openai-compatible`、支持 vision，**写新代码为零**。
既然现成的 BYOK 通路是完整的，再自建一个网关没有收益。

**两个连带结论**：

- AI 面板的定位变成「配置后可用」。未配置时给的是**配置引导**（去设置里选厂商、填 key），
  而不是登录引导。
- 账号体系失去存在意义 → 见 D2。

**选型硬约束**：默认厂商必须**同时出现在两套目录里**（chat 的 `AI_PROVIDERS` 和
media 的 `AI_MEDIA_PROVIDERS`），否则会出现"对话能用、生图不通"。

两边都有的 id 是 `openai` `gemini` `doubao` `glm` `qwen` `xai` `minimax` `custom`。
其中 `minimax` 在 media 侧**没有解析模型**（只能生图不能解析）；
`deepseek`、`kimi`、`anthropic`、`mistral` 等只在 chat 侧。

| 候选 | 两侧模型 | 定位 |
| --- | --- | --- |
| ✅ **`glm`**（智谱） | 生图 `cogview-4/3-flash`；解析 `glm-4.6v/4.6v-flash` | **已选为默认**（2026-09-24） |
| `qwen`（通义） | 生图 `qwen-image-plus/image`；解析 `qwen3-vl-plus/flash` | 国内备选 |
| `doubao`（豆包） | 生图 `doubao-seedream-5-0/4-5`；解析 `doubao-seed-2-1-pro/turbo` | 国内备选 |
| `openai` / `gemini` | 各自的图像模型与视觉模型 | 海外场景 |
| `custom` | 两套目录都有（模型由用户填） | 自带网关/自建端点 |

设置页保留全部 BYOK 厂商加 `custom`，用户随时可以改选。

**用户侧约束**（写进帮助或首次引导即可，代码层已由 `capabilities.vision` 标注）：

- 所选**模型**要支持 vision（文档截图/图片分析）和 tool call（AI 面板动作），
  否则对应功能不可用。
- 流式由 `openai-compatible` / `anthropic` 协议实现，任何 OpenAI 兼容端点都满足。
- 原实现给 claude 特意走 anthropic 协议**保图片保真**；若用 OpenAI 兼容端点跑 claude 系模型，
  保真度会降一点——可以在帮助里提示「用 anthropic 原生 key 效果更好」。

## D2：账号体系整体移除

**决策**：登录 UI、IPC、凭据、credits、云项目**全部清掉**。

**为什么**：D1 定的是纯 BYOK 且没有自有网关，**没有账号可挂**。
登录态原本的唯一作用是给 genspark 代理服务做鉴权，后端没了它自然失效。

> 由此带出一个必须一起删的东西：`gskApiKey` 的第三级回落会去读
> `~/.genspark-tool-cli/config.json`，**静默复用用户本机的 gsk 登录态**。
> 留着它等于拿用户的计费身份去打上游，属于必须删干净的一类。

## D3：搜索 / 生图 / 媒体解析

### 搜索

**决策**：删掉 gsk 分支，**补一家国内 provider（默认 `bocha`，博查）**，
**加 `custom` 端点**（给自建 SearXNG 的用户）；墙外的 Serper / Tavily / DuckDuckGo **全部保留**。

**为什么必须补**：原来的链路是 gsk（登录态）→ Serper → Tavily → DuckDuckGo。
后三级里，Serper 的 `google.serper.dev`、Tavily、DuckDuckGo 的 HTML 抓取
**国内都无法直连**，而且 DuckDuckGo 那级的超时只有 5 秒。

所以「删掉 gsk 就等于零后端可用」**对国内不成立**——不补后端时的真实表现是
「点搜索，等 5 秒，然后失败」。

**国内后端候选**：

- **博查 Web Search**（已选）——国内直连，响应约 1 秒，响应格式兼容 Bing Search API。
- 智谱 Web Search——如果 D1 选了 `glm`，可以和对话/生图**复用同一个 key**（少注册一家）。
  当前的选择是 `glm` + `bocha`，用户需要注册两家；这条备选留待后续权衡。

**`custom` 端点契约**（建议两种都兼容，同一个解析器可以吃掉，实现成本一样）：

- SearXNG JSON：`{results:[{title, url, content}]}`（自建场景最常见）
- 极简契约：`{results:[{title, url, snippet}]}`

**默认值**：

1. 搜索 provider 默认 `bocha`。
2. `custom` 的图片搜索设 `false`——`AiSearchProviderMeta.imageSearch` 是静态布尔，
   自定义端点无法预知是否支持；图片搜索仍走 DuckDuckGo 兜底。

> **注意**：默认 provider 只决定设置页下拉框的初值。**没有 key 时任何 provider 都产生不了
> 可用后端**，真正要紧的是"未配置时给配置引导，而不是静默失败"（同 D1）。

### 生图与媒体解析

同为纯 BYOK。三个默认值（`image` / `analysis` / `videoAnalysis`）要和 D1 选同一个厂商，
且必须在 chat ∩ media 的交集内。未配置 key 时，生图与解析入口给**配置引导**，
不能报错也不能静默失败。

### 工作量估算

| 项 | 人日 | 说明 |
| --- | --- | --- |
| 搜索 | 2–2.5 | 原估 0.5 只算了"删"；补两个 provider 加类型/UI 字段后上调 |
| 生图 / 媒体 | 1–2 | |
| D1 主体 | 2–4 | 含回退逻辑重写与各面板的提示改造 |
