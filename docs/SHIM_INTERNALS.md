# 兼容层（shim）机制

原生 Electron 应用假设自己跑在 Windows/macOS/Linux 上，有一套固定的平台行为。
鸿蒙 fork 上这些假设有的不成立、有的会直接抛异常，shim 就是用来补齐这些落差的。

## 它不是库，是进程的 main

产物里 `app/package.json` 的 `main` 字段指向 `main-shim.mjs`——Electron 启动时加载的是它，
它再把应用真正的主进程 bundle 载进来。

所以改 shim 要记住：**源在 `scripts/shim/main-shim.mjs`，打包时被拷进产物**，
两者是两份东西。改完必须重新构建才生效。

## 装载顺序是铁律

**所有桩必须在加载 `out/main/index.js` 之前装完。**

原因：那个 bundle 在顶层就会求值 `process.resourcesPath` 和 `app.isPackaged`，
等它跑起来再打桩就晚了。

最后一步加载 bundle 时必须走 `createRequire` 以 CJS 方式加载，**不能用 dynamic import**。

## 桩清单

编号沿用源码里的注释。① 号是空的，历史上没用过。

| 编号 | 做什么 | 为什么需要 |
| --- | --- | --- |
| ② | `process.platform` 改成 `linux` | fork 上报的是 `openharmony`，跨平台分支普遍不认识这个值 |
| ③ | `process.title` 的 getter/setter | 系统没有 `setproctitle`，直接赋值会抛 |
| ④ | `process.resourcesPath` | **实测天然正确，所以默认跳过重定义**——见下方警告 |
| ⑤ | 设 HOME、XDG_*、TMPDIR，并 chdir 到沙箱 | 子进程只能 chdir 到沙箱下；用户数据统一落 el2 |
| ⑤b | 加 `disable-renderer-sandbox` 开关 | 必须赶在 app ready 之前加 |
| ⑥ | `app.isPackaged` 钉成 true | 应用里有二十多处按它分支，不走 packaged 布局会找不到资源 |
| ⑦ | 探测三个系统目录能不能写，不能就降级到沙箱 | 保存链不能因为权限没到位就断掉 |
| ⑧ | 单实例三个 API 恒返回 true | 实测原 API 本来就能用，打桩是为了让应用的锁逻辑直通；真正的单实例由 `launchType` 管 |
| ⑨ | powerMonitor 的订阅方法包一层 try | fork 缺 `setListeningForShutdown`，订阅即 native abort |
| ⑩ | WCO 三个 API 打桩 | fork 没有 `titleBarOverlay`，调用会抛 |
| ⑪ | 重映射 sidecar 的 spawn 路径 | 应用按打包布局拼路径，运行期实际在别处（见下） |
| ⑫ | 兜底托盘 | 预案，`GO_SHIM_TRAY=1` 才启用 |
| ⑬ | 定期把隐藏的 view 移出屏幕 | 见「输入死区」 |
| ⑭ | 剪贴板读侧静默 | 见「剪贴板」 |
| ⑮ | 注入避让 CSS | 见「系统按钮避让」 |
| ⑯ | 把探针数据注入页面 | 唯一的可靠观测通道 |
| ⑰ | 运行时打开文档 | 见「热启动」 |
| ⑱ | 生成真机测试文件 | **临时代码，发布前移除** |
| ⑲ | 退出诊断日志 | **临时代码，发布前移除** |

编号有两点要注意：**① 是空的**；**⑭ 被用了两次**——剪贴板桩是正主，
装载主 bundle 那段注释也标了 ⑭，那是笔误。

## 三个警告

**不要碰 `process.resourcesPath`。** 首亮时实测它天然就是对的，
所以代码默认跳过重定义。那个属性用 `defineProperty` 覆盖疑似会触发 native 异常，
除非真的遇到异常布局，否则别动。

**不要用 dynamic import 装载主 bundle。** bundle 是 CJS 的 `electron-vite` 产物，
ESM 语境下解析会报 `exports is not defined`，而 shim 的错误处理会 `app.quit()`——
表现出来是"卡在某个桩"，跟真正的原因完全不沾边。

**`app/package.json` 不能带 `type: module`。** 同上，这是当初踩得最久的一个坑。

## 输入死区（桩⑬）

**现象**：docs 的 ribbon 区域对鼠标和触屏都没反应，但 CDP 合成输入正常，
所有 view 的 `pointerdown` 都没触发。

**根因**：fork 上 hidden 的 WebContentsView 仍然参与命中测试。
shell 有个常驻隐藏的 spare view，切走的 tab 也是 hidden，而 `activateTab`
只给 active view 设 bounds，非 active view 的 bounds 冻在创建那一刻。

**做法**：周期扫描（1 秒一次），把 `getVisible()` 为 false 的 view 的 bounds
移到屏幕外（x = -30000）。`activateTab` 恢复时会重新设 bounds，不冲突。

## 剪贴板（桩⑭）

**现象**：打开 pptx 反复弹"无法访问系统剪贴板"。

**机制**：slides 在 mount 和 focus 时会探测剪贴板 → 主进程调 `availableFormats()`/`readText()`
→ 走 `@ohos.pasteboard`，没授权就弹系统提示 → 弹窗关闭导致 focus 回归 → 再次探测，
死循环。

**做法**：读侧先钉成空实现，等 entry 侧的 ArkTS 写来授权信号（`clip-perm.json`，
`granted: true`）再恢复。轮询 3 秒一次、最多 20 次；读到 `false` 或者超时，
读侧就永久静默。**写侧始终不受影响。**

**这里有个花了代价的教训**：中间试过"自证式探测"——写个标记再用原生 `readText` 读回来
验证授权。结果**没授权时调用原生读侧本身就会弹窗**，回归时 sheets 一打开就弹。
所以现在的原则是：**没拿到授权信号，绝不调用原生读侧**。

## 系统按钮避让（桩⑮）

桌面 Electron 用 CSS 的 `env(titlebar-area-*)` 把窗口按钮区的位置交给应用（WCO），
应用据此在右上角留出空间。鸿蒙引擎不提供这个变量，应用算出来的避让宽度恒为 0，
于是标题栏右侧的图标和系统三键重叠。

真值由 entry 侧监听 `windowTitleButtonRectChange` 后落盘，shim 读文件注入等效 CSS
给 `.tab-bar-caption-spacer`。2 秒重读一次，窗口缩放或按钮显隐变化后能自愈。

一个实现上的妥协：那个文件里 `right` 和 `width` 的语义（是否都表示距窗口右缘）
不明确，代码取两者中较大的兜底。

## 热启动：三段链（桩⑰）

应用已经在运行时再打开一个文件，走的是这条链，跨三个组件：

```
系统复用 Ability 实例（走 onNewWant）
      ↓  EntryAbility 写 open-doc.json（含 path 和 seq）
shim 每 1.5 秒轮询这个信号文件
      ↓  读 <userData>/control.json 拿 token 和 socket 端点
连 control.sock，发 {token, request: {cmd: 'open', path}}
      ↓
应用自带的 control-server 在现有窗口里打开文档
```

**任一层改都会断链**，这是目前跨组件最多的一个机制。
第 ⑰ 桩之外，还需要 entry 侧的 `onNewWant` 和应用的 control-server 配合。

## 探针（桩⑯）

日志通道都不太可靠（见下），所以 shim 每 2 秒把内部状态注入渲染进程，
用 CDP 读 `window.__GO_INFO__` 即可。

内容包括：原始与打桩后的 `platform`/`isPackaged`/`resourcesPath`、
三个目录的实际落点与可写性、剪贴板授权信号状态、生成的测试文件列表。

## 日志的三个通道

代码会同时往三个地方写，各有各的失效条件：

| 通道 | 失效条件 |
| --- | --- |
| 沙箱文件 `/data/storage/el2/base/files/shim-log.txt` | 应用视角的路径，hdc 读不到；要从物理路径读，见 `DEVICE_OPERATIONS.md` |
| 公共目录 `<用户目录>/Documents/<应用名>/shim-log.txt` | **只有三目录权限到位才写得进去**——能写成本身就是权限生效的证据 |
| console → hilog | 会被 flowcontrol 丢，启动期的日志尤其容易缺 |

另外，未捕获异常和未处理的 Promise 拒绝在**最开头**就装了处理器——因为退出时
console 的缓冲可能丢失，只有文件日志靠得住。

## 临时代码

桩⑱ 和 桩⑲ 都标着"发布前移除"，但**目前没有任何清单在追踪这件事**，
见 `OPEN_ITEMS.md`。

- **桩⑱** 生成七个探针文件到桌面，供文件关联抽验用。设 `GO_TEST_FILES=0` 可关闭。
- **桩⑲** 只做一件事：把退出链上的每个事件打进日志，用来定位"bundle 加载成功
  却 15 秒后退出"。它和"未授权导致的静默退出"是两个不同的现象，别混。
