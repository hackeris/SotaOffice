# 文档索引

本工程的全部文档都在这个目录。先看「按角色找」或「按主题找」。

## 按角色找

| 你要做的事 | 从哪开始 |
| --- | --- |
| 刚接手，想知道这是什么 | 仓根 `CLAUDE.md`，然后 `PORT_DESIGN.md` 的 §0～§3 |
| 要把工程构建起来、装到真机 | **`BUILD_AND_DEPLOY.md`** |
| 应用装了但起不来、行为怪 | **`DEVICE_OPERATIONS.md`** |
| 要申请权限、换签名、搞不清 ACL | **`PERMISSIONS_ACL.md`** |
| 要改兼容层（shim） | **`SHIM_INTERNALS.md`** |
| 想查某个坑是不是踩过 | **`PITFALLS.md`** |
| 想知道还有什么没做完 | **`OPEN_ITEMS.md`** |
| 要做发布前的去上游化改造 | `SOTA_RELEASE_TODO.md`（执行清单）+ `SOTA_DECISIONS.md`（为什么这么选） |
| 要给 Electron fork 提 issue | `UPSTREAM_FEEDBACK.md` |
| 想知道某段移植决策怎么来的 | `PORT_DESIGN.md` §0～§6 |

加粗的六份是常用文档，遇到具体问题先翻它们。

## 按主题找

一个主题的知识往往散在好几处，下表把它们串起来。带「★」的是该主题当前的主文档。

| 主题 | 涉及哪些文件 | 说明 |
| --- | --- | --- |
| **架构与选型** | ★`PORT_DESIGN.md` §0～§3、`appendix/A-genoffice-architecture.md` | 附录 A 是上游应用的源码级账本，PORT_DESIGN 是决策 |
| **构建与可复现** | ★`BUILD_AND_DEPLOY.md`、`scripts/` 各脚本头注释、`M1_ACCEPTANCE.md` §3 | 脚本注释比文档更新得快，冲突时信脚本 |
| **兼容层与桩** | ★`SHIM_INTERNALS.md`、`PORT_DESIGN.md` §11.3、`scripts/shim/main-shim.mjs` | 源码头注释里有完整的排障实录 |
| **真机排障** | ★`DEVICE_OPERATIONS.md`、`M2_VERIFY_CHECKLIST.md` 命令备忘 | 取证手段、日志通道、hdc 的坑 |
| **权限与 ACL** | ★`PERMISSIONS_ACL.md`、`web_engine/src/main/module.json5`（唯一事实源）、`M1_ACCEPTANCE.md` §4 | 之前四份文档给过四版权限清单，已收敛到 PERMISSIONS_ACL |
| **踩坑记录** | ★`PITFALLS.md` | 按主题归类，横向汇总 |
| **未闭合项** | ★`OPEN_ITEMS.md` | 技术债登记处 |
| **装载链** | `ELECTRON_OHOS_CHECKLIST.md` §1～§3 与附 A、`appendix/C-hos-vscodium-runtime.md` | 以 CHECKLIST 附 A 的图为准 |
| **文件关联** | ★`PORT_DESIGN.md` §11.9、`M2_VERIFY_CHECKLIST.md` §B、`ELECTRON_OHOS_CHECKLIST.md` §5.2 | 方案演进过三轮，只看前两个 |
| **窗口装饰与三键避让** | ★`PORT_DESIGN.md` §11.6、`M2_VERIFY_CHECKLIST.md` §C | |
| **打印** | ★`M2_VERIFY_CHECKLIST.md` §D1、`UPSTREAM_FEEDBACK.md` #5、`MIGRATION_ISSUES.md` L2.3 | 结论一致，落地判据在 M2 |
| **fork 已知缺陷** | ★`UPSTREAM_FEEDBACK.md`、`PORT_DESIGN.md` §11.6、`ELECTRON_OHOS_CHECKLIST.md` 附 C | 缺陷状态几处不一致，以 UPSTREAM_FEEDBACK 为准 |
| **原生二进制** | ★`MIGRATION_ISSUES.md` L6、`PORT_DESIGN.md` §5.1 | Rust sidecar 交叉编译配方、wasm 预验 |
| **发布改造** | ★`SOTA_RELEASE_TODO.md`（清单）、`SOTA_DECISIONS.md`（决策依据） | |
| **字体与视觉基线** | ★`MIGRATION_ISSUES.md` L7、`appendix/A` §7 | 尚未启动，无真机数据 |

## 已经修掉的文档问题

2026-09-24 整理文档时修正了下面几处。列出来是让你知道**旧版本里曾经是错的**，
万一看到旧的快照或引用，别被带偏。

| 曾经的问题 | 现状 |
| --- | --- |
| `MIGRATION_ISSUES.md` 的状态标记全是静态分析期的预测 | 文首已加补注，说明标记不等于现状 |
| `PORT_DESIGN.md` §11.7「剩余」写着 G4 未完成 | 已标注完成 |
| `ELECTRON_OHOS_CHECKLIST.md` §10 第 ⑦ 条要求 package.json 带 `type: module` | 已改为"禁带"，与 §3 一致 |
| `M2_VERIFY_CHECKLIST.md` 的 B6 行写着"✗ 白窗口" | 已改为已修，与同文件实测记录一致 |

## 仍然存在的问题

1. **`module.json5` 里三目录的注释是错的**——它写"system_grant，装上即授予"，
   实测是 user_grant，必须运行时申请。那是代码文件里的注释，还没改；见 `PERMISSIONS_ACL.md`。
2. **`PORT_DESIGN.md` 开头承诺过两份配套文档——`KEYPOINTS.md` 和 `FEATURE_MATRIX.md`——
   但一直没写出来**。它们想承载的内容现在散在别处：决策与踩坑在 `PORT_DESIGN.md` §0 和
   `PITFALLS.md`，能力矩阵与验收在 `ELECTRON_OHOS_CHECKLIST.md` §5 和 `M1_ACCEPTANCE.md`。
   那行承诺已改为指向这些文档。

   （注：早先的审计还列过一批"死引用"，复核后确认是误判——`dialog.showSaveDialog` 这类是
   API 名、`copy.sh` 属于官方指导项目、`build-app.sh` 的退役正文里已有说明。不需要处理。）

## 文档状态

| 状态 | 文档 |
| --- | --- |
| **操作手册**（随工程更新） | `BUILD_AND_DEPLOY.md`、`DEVICE_OPERATIONS.md`、`PERMISSIONS_ACL.md`、`SHIM_INTERNALS.md` |
| **横向登记**（随工程更新） | `PITFALLS.md`、`OPEN_ITEMS.md` |
| **活文档**（随工程更新） | `PORT_DESIGN.md`、`M2_VERIFY_CHECKLIST.md`、`SOTA_RELEASE_TODO.md`、`SOTA_DECISIONS.md`、`thirdparty/VERSIONS.md` |
| **验收记录**（完成后归档，不再改） | `M1_ACCEPTANCE.md` |
| **快照**（某个时点的分析，故意不更新） | `poc2-breakage-report.md`、`appendix/A`、`MIGRATION_ISSUES.md` |
| **对外材料** | `UPSTREAM_FEEDBACK.md`（面向 fork 维护方） |

`appendix/B`、`appendix/C` 是移植早期调研另一个工程留下的方法论与运行时说明，方法部分长期有效，
里面提到的具体资产未必适用于本项目。

## 脚本与文档的对应

排查问题时，先读脚本头注释，那里通常比文档更详细、更新更快。

| 脚本 | 说明 | 相关文档 |
| --- | --- | --- |
| `sync-engine.sh` | 组装引擎二进制与资源 | `BUILD_AND_DEPLOY.md` 第一步 |
| `build-genoffice.sh` | 组装应用产物到 resfile | `BUILD_AND_DEPLOY.md` 第二步 |
| `build-ohos.sh` | 权限校验、打包 HAP | `BUILD_AND_DEPLOY.md` 第三步、`PERMISSIONS_ACL.md` |
| `grant-acl.sh` | 装机后授权 | `DEVICE_OPERATIONS.md` 授权一节 |
| `m1-rebuild-drill.sh` | 毁灭性重建演练 | `BUILD_AND_DEPLOY.md` 证明可复现 |
| `verify-file-assoc.sh` | 文件关联抽验 | `M2_VERIFY_CHECKLIST.md` §B |
| `e2e/ohos-smoke.mjs` | 真机 smoke | `M1_ACCEPTANCE.md` §2 |
| `selfcheck-cdp.mjs` | 自检 HAP 的 CDP 探针 | `PORT_DESIGN.md` §10 |
| `poc2-breakage-scan.sh` | 兼容性清点（一次性） | `poc2-breakage-report.md` |
| `gen-icons.py` | 生成鸿蒙图标资源 | — |
| `shim/main-shim.mjs` | 打包进 HAP 的兼容层 | `SHIM_INTERNALS.md` |
| `selfcheck-app/` | 自检 HAP（排障用的已知好基线） | `BUILD_AND_DEPLOY.md` 开关一览 |

## 写文档的约定

新写或改动这里的文档时，按这三条来：

1. **不写本地环境信息**。绝对路径、IP、设备型号都不进文档——仓内路径用相对形式表达，
   仓外的写成「本机另一工程」或用占位符（`<device>`、`<OHOS-SDK>`）。
   例外是技术证据本身：实测拿到的原始字符串（比如 UA）要原样保留，改了就成了伪造证据。

2. **中文日常书面表达**。不要英文式的翻译腔——避免「该文档提供了……」「值得注意的是……」
   这类句式，用「看着像崩溃，其实只是没授权」这样的说法。

3. **术语用原文**。Electron、HAP、HAR、shim、renderer、preload、napi、ACL、resfile、
   sidecar、submodule、fork 这些不翻译。

索引这一层也要维护：新增文档时把它接进「按角色找」和「按主题找」两张表，
做完一项就把 `OPEN_ITEMS.md` 里对应的条目划掉。
