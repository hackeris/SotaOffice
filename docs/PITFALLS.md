# 踩坑总账

按主题归类，不按时间。每条讲清楚：现象、根因、现在怎么绕。

内容重复的地方只做摘要，细节指向对应文档。

## 构建与打包

### 主进程 bundle 被当成 ESM 解析

**现象**：应用起不来，日志停在某个桩上，看起来像那个桩有问题。
**根因**：主进程 bundle 是 `electron-vite` 产的 CJS，而 `app/package.json` 误带了
`type: module`，于是按 ESM 解析，报 `exports is not defined`；shim 捕获异常后
`app.quit()`，"死在桩上"只是表象。
**做法**：产物 `package.json` 不许带 `type: module`；装载 bundle 一律走 `createRequire`。
这是首亮阶段耗得最久的一个坑，**症状和根因完全不沾边**。

### 退出时 console 缓冲丢失

**现象**：日志断在某个桩，像是卡住了。
**根因**：进程退出时 console 的输出可能还没刷出去。
**做法**：未捕获异常的处理器在 shim 最开头就装好，以文件日志为准。
真卡住了，用"零桩直载"二分定位。

### 大清单管道吞错

**现象**：构建随机报"缺关键件"，而且每轮挂的文件还不一样。
**根因**：`echo "$长清单" | grep -q ...`——`grep -q` 命中就退出，`echo` 收到 SIGPIPE，
在 `set -o pipefail` 下整条管道被判失败。
**做法**：清单先落盘再 grep。

### hvigor 不自动装依赖

**现象**：`Cannot find module 'web_engine'`，连着报二十多条。
**根因**：hvigor 不会自己跑 `ohpm install`。
**做法**：构建脚本里显式调。

### 重建 build-profile 后缺模块注册

**现象**：OhmUrl 解析失败，十五连错。
**根因**：删掉 `build-profile.json5` 后从旧模板重建，模板里缺了 web_engine 的注册。
**做法**：模板已补；重建后跑一次完整构建确认。

### 引擎 so 是 LFS 指针

**现象**：装到真机上是白屏，但安装本身成功。
**根因**：克隆时没跳过 LFS smudge，`libelectron.so` 只有约 130 字节。
**做法**：克隆加 `GIT_LFS_SKIP_SMUDGE=1`；构建期有 `>100MB` 断言拦截。

### 应用产物的依赖安装

**现象**：`npm ci` 卡住或失败。
**根因**：electron 的 postinstall 直连 GitHub 会超时；另外 `cargo` 不在 PATH 时
sheets 的原生构建会失败。
**做法**：`--ignore-scripts` 之后手动跑 install 并指定镜像，`cargo` 加进 PATH。

## 路径映射

### 构建期和运行期不是同一套

**现象**：按源码目录拼的路径在真机上不存在。
**根因**：源布局是 `libs/arm64-v8a/`，**运行期实际是 `libs/arm64/`，没有 `-v8a`**。
**做法**：以运行期为准写路径。

### 调试配置放错位置

**现象**：远程调试端口 9333 起不来。
**根因**：`dev_config.json` 被放进了 resfile。
**做法**：它必须放在 entry 的 libs 下——`libadapter.so` 里硬编码读那个位置。

### shell 看不到用户目录

**现象**：`ls /storage/Users` 报不存在，`hdc file send` 过去报 `Error opening file`。
**根因**：shell 对用户区是命名空间隔离，**不是权限问题**。
**做法**：需要落到公共目录的文件（比如文件关联的测试样本）必须由应用侧生成。

## 鸿蒙平台行为

### 白屏的三个易漏点

`nativeLib.collectAllLibs` 没开、`CustomChildProcess.toString()` 注册被删、
`runBrowser` 没在 XComponent 的 onLoad 里调。三者任一漏掉都是白屏。
详见 `ELECTRON_OHOS_CHECKLIST.md` §2。

### 平台标识不认识

fork 上报 `process.platform` 是 `openharmony`，三方库的平台分支普遍不认识这个值。
shim 打桩改成 `linux`。

### 多实例的正解

`multiAppMode` 在 API 26 上不被承认，specified 启动被拒。
正解是用 entry 的 `launchType`。

### 隐藏的 view 会拦截输入

见 `SHIM_INTERNALS.md` 的「输入死区」。CDP 合成输入正常、真机输入消失，是这个坑的特征。

### 未授权时探测剪贴板会自杀

没拿到剪贴板权限时，**调用原生读侧本身就会弹系统窗**——所以"写标记再读回来验证"
这种自证式探测是行不通的，只会把弹窗引出来。见 `SHIM_INTERNALS.md` 的「剪贴板」。

### 系统三键不在无障碍树里

`uitest` 能点到系统弹窗和应用内的 DOM，**但点不到系统标题栏的三个按钮**。
按坐标硬点会误触旁边的"全部标签"。

### 官方矩阵可能过于悲观

API 支持面矩阵标着"不支持"的 `requestSingleInstanceLock`，真机上实际返回 true。
**能实测的就别只信矩阵。**

## 权限与签名

### 未授权导致"静默崩溃"

三条目录权限没授权时，渲染进程不会创建，应用走 `window-all-closed` 退出：
**退出码 0、没有异常、`ps` 里连 renderer 都没有**。看着像崩溃，其实只是没授权。
而且卸载重装会清空授权。详见 `DEVICE_OPERATIONS.md`。

### 声明与 profile 必须一致

声明了但 profile 的 ACL 没覆盖 → 装机报 `9568289`；反过来 profile 有而没声明 →
`atm perm grant` 报错。**ACL 资格按应用走，不能跨应用借用**——这条已经实验证实过，
不要再试。详见 `PERMISSIONS_ACL.md`。

### 只声明不申请是不够的

ACL 给的是"申请资格"，不是"已授予"。三目录只声明、profile 也覆盖，但没走运行时申请时，
往用户目录写**全部报 EPERM**。

## 调试手段

### CDP 合成输入不等于真实输入

踩过两次：一次是输入死区（CDP 里一切正常，真机上事件消失），
一次是结构化编辑器里 `uitest uiInput inputText` 不落字。
**排障时不能只信 CDP。**

### 启动期日志会缺段

hilog 有流控，启动期的日志经常被丢掉。
读 shim 日志要走沙箱的**物理路径**，别用应用视角的路径。

### hdc 不传退出码

`hdc shell` 不会把远端的退出码带回来，所以脚本里不能用 `if hdc shell ... grep -q` 判断，
要靠输出计数。`bm install` 失败时返回码同样是 0。

### uitest 点击偶发不生效

重试，或者先把窗口激活再点。取坐标前先 `dumpLayout` 拿精确 bounds，
不要凭截图估算——曾经把窗口顶看偏 10 个像素，结论一度翻转。

## 研究阶段

### 主机的图形栈跑不了 Electron GUI

libc 的 ELF 头不匹配，冒烟必须上真机或 WSLg。

### 静态断点不等于迁移容易

electron 43 → 37 的 typecheck 和 build 都是零断点，但真正的风险在运行时行为。
详见 `poc2-breakage-report.md` 与 `MIGRATION_ISSUES.md` 的验证深度声明。

### 正则别截数字

做 i18n 扫描时，正则把版本号里的数字截进去，产生了假阳性。
