# 真机操作与排障

应用装到真机之后，怎么取证、怎么看日志、怎么判断问题出在哪儿。

## 三个取证手段

**先拿证据再动手改代码**。真机上的问题，靠猜十次不如截一张图。

### uitest：拿控件树和坐标

```sh
hdc -t <device> shell "uitest dumpLayout -p /data/local/tmp/l.json"
hdc -t <device> file recv /data/local/tmp/l.json /tmp/l.json
```

导出的 JSON 里有每个控件的精确 bounds。**要用某个控件时，先 dump 拿 bounds，再点它的中心**，
不要凭截图估算——曾经在截图里把窗口顶看偏 10 个物理像素，结论一度翻转。

```sh
hdc -t <device> shell "uitest uiInput click <x> <y>"
```

能点到的范围：系统弹窗（授权框就是 ArkUI 弹窗，在树里），以及 **Electron 应用内的 DOM**
（无障碍树里能看到"菜单""关闭标签""保存"这类元素）。

**点不到的范围：系统标题栏的三个按钮**（最小化／最大化／关闭）。它们不在无障碍树里，
按坐标硬点会误触旁边的"全部标签"。三键的坐标只能从窗口 rect 推算，见下。

另外，结构化编辑器（HTML、Markdown）里 `uitest uiInput inputText` 不落字——点中块会弹出浮动工具条，
所以编辑态的脏检查链目前只能人工验。

### snapshot_display：截图

```sh
hdc -t <device> shell "snapshot_display -f /data/local/tmp/scr.jpeg"
hdc -t <device> file recv /data/local/tmp/scr.jpeg /tmp/scr.jpeg
```

比翻 hilog 直观得多，很多问题一看图就清楚了（比如"白屏"到底是全白还是有 UI 没内容）。

### hidumper：窗口树

```sh
hdc shell "hidumper -s WindowManagerService -a '-a'"
```

拿窗口的 rect，配合 uitest 推算系统三键的位置。

### CDP：读 DOM 和执行 JS

```sh
hdc fport tcp:9333 tcp:9333
```

端口映射之后，`http://127.0.0.1:9333/json/list` 能看到 target 列表。
注意 **CDP 合成输入不等于真实输入**——曾经遇到 CDP 里事件正常、真机上事件消失的情况，
排障时不能只信 CDP。

## 日志：三个通道，各有各的失效条件

| 通道 | 位置 | 什么时候能用 |
| --- | --- | --- |
| **沙箱文件**（首选） | 物理路径 `/data/app/el2/100/base/<bundle>/files/shim-log.txt` | 一直可读，不受 hilog 流控影响 |
| 公共目录 | `<用户目录>/Documents/<应用名>/shim-log.txt` | **只有三目录权限到位才写得进去**——写成功本身就是 ACL 生效的实证 |
| hilog | `hdc shell "hilog -x \| grep GO-SHIM"` | 启动期的日志常被流控丢掉，只适合看运行期 |

读沙箱文件要认准**物理路径**：

```sh
hdc -t <device> shell "tail -40 /data/app/el2/100/base/app.fuqidian.sotaoffice/files/shim-log.txt"
```

用应用视角的 `/data/storage/el2/base/files/` 会报 Permission denied，**这是两个不同的路径**，
不是权限问题。

`hilog` 加 `-x` 是非阻塞 dump 后退出。

## hdc 的三个坑

1. **`hdc shell` 不传递远端的退出码**。所以脚本里不能用 `if hdc shell ... grep -q` 判断成功与否，
   得靠输出计数。这个坑已经让脚本误报过。
2. **shell 对 `/storage/Users` 是命名空间隔离**。`ls /storage/Users` 报
   `No such file or directory`，`hdc file send` 到那下面报 `Error opening file`——
   **都看不到用户目录，跟权限无关**。所以装到桌面的探针文件必须由应用侧生成，
   不能从 hdc 侧写。
3. **`bm install` 失败时返回码仍是 0**。判断装机成功要看输出，不能看退出码。

## 授权：装机后必做

三条目录权限（文档／下载／桌面）是 user_grant。首次启动依次弹三个系统模态框，
编号是 1/3 文档 → 2/3 下载 → 3/3 桌面。

```sh
bash scripts/grant-acl.sh <device>
```

脚本自动点三次"允许"、重启应用、再核验。

**没授权的表现**：渲染进程不会创建，应用走 `window-all-closed` 退出——退出码 0、没有异常、
`ps` 里连 renderer 都没有。**看着像崩溃，其实只是没授权**。卸载重装会清空授权，每次重装都要重跑。

核验看 shim 日志里第⑦桩的输出：

- 三条都报 `系统目录可写` → 授权生效
- 出现 `降级 → el2` → 那条权限还没生效

如果日志里同时出现"降级"和"系统目录可写"，那是授权前那一轮启动留下的，**以时间戳最新的一段为准**。

## 现象对照

### 两个"15 秒退出"，不要混为一谈

| 现象 | 区别 |
| --- | --- |
| 没授权导致的退出 | `ps` 里没有 renderer 进程，日志能走到第⑦桩报"降级" |
| 桩⑲ 记录的退出 | shim 全部桩就位、主 bundle 已 loaded，之后约 15 秒退出，无未捕获异常，NetworkService 子进程退出码 0 |

后者是当时用来定位"bundle 加载成功却退出"的临时诊断桩，**发布前要移除**。

### 白窗口

历史上出现过两个白窗口问题，成因完全不同：

- **初次启动全白**：三个易漏点——`nativeLib.collectAllLibs` 没开、`CustomChildProcess.toString()`
  注册被删、`runBrowser` 没在 XComponent 的 onLoad 里调。见 `ELECTRON_OHOS_CHECKLIST.md` §2。
- **热启动白窗口**：运行中再打开一个文件，窗口是白的。已经通过 onNewWant 写信号文件、
  shim 轮询后经 control.sock 发命令解决，见 `PORT_DESIGN.md` §11.9。

### 输入没反应

docs 的 ribbon 区域对鼠标和触屏都无响应，而 CDP 合成输入正常。
根因是 fork 上 **hidden 的 WebContentsView 仍然参与命中测试**，挡住了事件。
修复方式是桩⑬ 定期把不可见的 view 移到屏幕外（parking）。

### 剪贴板反复弹窗

slides 在 mount 和 focus 时会探测剪贴板，在没授权的情况下会触发系统弹窗，
弹窗关闭后又 focus → 再次探测，形成死循环。现在的做法是**没拿到授权信号就绝不碰读侧**，
详见 `PORT_DESIGN.md` §11.6。

## 坐标备忘

特定窗口状态下实测的值，换设备或换分辨率要重新测。

| 场景 | 窗口 rect | 三键坐标（最小化／最大化／关闭） |
| --- | --- | --- |
| 窗口态 | `[266,119][2850,1830]` | (2722,142) / (2636,142) / (2797,142) |
| 最大化 | `[0,0][3120,1955]` | (2978,35) / (2900,35) / (3055,35) |

**再次提醒：三键不在无障碍树里，只能按坐标点，且先确认窗口状态**——点错位置会打开"全部标签"。
