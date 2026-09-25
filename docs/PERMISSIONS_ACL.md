# 权限与 ACL

权限这条线横跨六处：声明、签名 profile、构建校验、装机、运行时申请、降级。
这份文档把它们串起来，省得每次都要翻四个文件。

> **权限清单以本文为准**；别处的清单若与此不一致，是那边旧了。

## 声明写在哪

**唯一事实源是 `web_engine/src/main/module.json5`**。

它是 HAR 模块，权限随 HAR 合并进 entry——**entry 自己一条权限都不声明**。
改权限别改错文件。`reason` 文案在三份 `string.json` 里（base / zh_CN / en_US）。

## 当前清单

12 条 `requestPermissions`，分三类：

| 类别 | 条数 | 内容 |
| --- | --- | --- |
| Electron 运行时 | 1 | `kernel.ALLOW_WRITABLE_CODE_MEMORY` —— V8 的 JIT 和 wasm 靠它，引擎级必需 |
| 应用集（system_grant） | 7 | INTERNET、GET_NETWORK_INFO、RUNNING_LOCK、PREPARE_APP_TERMINATE、FILE_ACCESS_PERSIST、GET_FILE_ICON、PRINT |
| ACL 受限 | 4 | READ_PASTEBOARD，以及文档／下载／桌面三条目录权限 |

另有 2 条 `definePermissions`：`kernel.ALLOW_WRITABLE_CODE_MEMORY` 与 `LOCK_WINDOW_CURSOR`。

### 三种写法

| 类别 | 写法 |
| --- | --- |
| 普通系统权限 | 只写 `name` |
| ACL 受限权限 | `name` + `reason` + `usedScene` |
| 自定义 kernel 权限 | 在 `definePermissions` 里定义，`requestPermissions` 里只写 `name` |

**HAR 模块的受限权限必须带 `reason`**，否则 hvigor 报 `00303222`。`kernel.*` 不受这条限制。

## ACL 那四条是 user_grant，必须运行时申请

实际情况（2026-09-24 真机实测）：只声明、且签名 profile 也覆盖了，但没有运行时申请的话，
往用户目录写会**全部报 EPERM**。**ACL 给的只是"申请资格"，不是"已授予"。**

所以这四条（READ_PASTEBOARD + 三目录）声明之后，还要在窗口就绪后走
`requestPermissionsFromUser` 弹窗申请。装机后跑 `grant-acl.sh` 就是在做这件事。

没申请的后果很严重：渲染进程根本不会创建，应用静默退出，看着像崩溃。
详见 `DEVICE_OPERATIONS.md` 的授权一节。

## 三道门槛，缺一不可

```
声明（module.json5）  ←→  签名 profile 的 ACL  ←→  运行时申请
```

前两道必须**严格一致**，任何一边多或少都装不上：

| 情况 | 结果 |
| --- | --- |
| 声明了，但 profile 的 ACL 没覆盖 | 装机报 `9568289` |
| profile 有，但应用没声明 | `atm perm grant` 报 "Permission is not requested" |
| 声明和 profile 都有，但没运行时申请 | 应用能装能起，但访问受限资源全部失败 |

**ACL 资格是按应用走的，不能跨应用借用**——这条已经实验证实过，不要再试。
现有三份材料里只有 SotaOffice 档是五件齐的，另两份各缺一部分（见下表）；想要它们也齐，
得按那个包名重新申请，不能把别的档的条目借过来。

## 签名材料

签名材料不在仓里（`scripts/.signing.snippet*` 是 gitignore 的），换包名就要换材料。
现有三份：

| 文件 | 包名 | ACL 覆盖 |
| --- | --- | --- |
| `.signing.snippet`（当前） | `app.fuqidian.sotaoffice` | **五件齐**，可做完整回归 |
| `.signing.snippet.magicflow.bak` | `app.fuqidian.magicflow` | **仅 JIT**，只能做调试 |
| `.signing.snippet.winehua.bak` | `app.hackeris.winehua` | 含 JIT 与部分目录权限 |

> 第三份的覆盖范围，文件注释写的是"JIT + 三目录"，但早先对 profile 做的 strings 实测显示
> 只有文档和下载两条、没有桌面，也没有 READ_PASTEBOARD。**要借这个档之前先自己核一遍**，
> 别照着注释信。

**切换档位后必须同步改声明**：profile 覆盖不到的那几条权限要从 `module.json5` 里去掉，
`build-ohos.sh` 的必需清单也要跟着改，否则装机就报 9568289。

材料本身与包名强绑定，`build-profile.json5` 是从模板加片段生成的（该文件带明文口令，不入库）。

## 申请状态

以 `app.fuqidian.sotaoffice` 的名义在 AGC 申请中：

| 权限 | 类型 | 用途 |
| --- | --- | --- |
| `kernel.ALLOW_WRITABLE_CODE_MEMORY` | ACL | V8 JIT 与 wasm，引擎级必需（这条是续期） |
| `READ_PASTEBOARD` | user_grant | 剪贴板读取 |
| 文档／下载／桌面三条目录 | user_grant | 用户目录直读直写 |

2026-09-24 调试 profile 到位，五件齐，signed HAP 装机成功。
另外 `app.fuqidian.pureoffice` 名下的 READ_PASTEBOARD 已经在 AGC 获批，说明这条申请通道走得通。

## 永久不申请

这些已经定过：沙箱加 picker 够用，不需要全盘和用户文件权限；
`LOAD_INDEPENDENT_LIBRARY` 是命令行工具的诉求，不是 Electron 运行时的（引擎的 so 走 HAP 签名体系装载）；
零 napi 模块，所以也不需要加载外部原生代码的权限。
剩下的是一堆跟本项目无关的权限，随 38 条一起裁掉了。

## 改权限的步骤

1. 改 `web_engine/src/main/module.json5`
2. 受限权限确认 `reason` 文案在三份 `string.json` 里都有
3. 同步 `build-ohos.sh` 里的必需清单（五条必需 + 未获批权限不得出现）
4. 确认签名 profile 的 ACL 覆盖了改动后的集合
5. `npm run build:ohos` → 装机 → `grant-acl.sh`
