# 上游回馈材料(Electron-OHOS fork 实测问题)

> 状态:2026-09-23 整理(M1 真机验收 + M2 排查产物),可直接转为 upstream issue
> 环境:OHOS API 26 / 2in1 / `electron-v37.2.0-openharmony`
> 纪律:每条标注**证据等级**——`实测`=有可复现数据;`定位`=已缩小到代码范围;`源码`=在 fork 源码中直接可见

| # | 问题 | 证据等级 | 影响面 |
|---|---|---|---|
| 1 | 设备能力未上报(hover/pointer/touch 全空) | 实测 | 高:响应式 UI 全面误判 |
| 2 | hidden 的 WebContentsView 仍参与命中测试 | 实测(含绕行验证) | 高:多视图应用输入死区 |
| 3 | `dialog.showSaveDialog` 的 `defaultPath` 文件名不回填 | 实测 + 定位 | 中:保存体验 |
| 4 | `setTitleBarOverlay` 与 WCO(`env(titlebar-area-*)`)缺失 | 实测 | 中:自绘按钮可绕但需避让数据 |
| 5 | `webContents.print()` 无实现(PrintAdapter TODO) | 源码 | 中:可降级为导出 PDF |
| 6 | 触摸设备上 canvas 自绘网格(如 Univer)的输入交互失效 | 实测(含事件链探针) | 高:表格类应用在触屏设备不可用 |

---

## 1. 设备能力未上报:PC 设备却报触屏形态

**现象**:2in1(PC)设备上,Blink 侧设备能力全空且自相矛盾——UA 声明为 PC(Windows NT),能力查询却是"无任何精细指针":

```
hoverNone        : true          # 「不存在可 hover 的指针」
pointerCoarse    : false
pointerFine      : false
anyPointerCoarse : false
anyPointerFine   : false
maxTouchPoints   : 0
'ontouchstart' in window : false
```

**影响**:CSS 响应式分支选错——`@media (hover: hover)` 的 UI 不出现、`(hover: none)` 的触屏优化尺寸被选中;JS 侧 `matchMedia` 驱动的交互降级同样误判。

**旁证(排除"输入链路坏了")**:系统级输入注入(`uitest uiInput click`)可正常操作应用、指针事件正常派发,故这是**能力上报缺失**,非输入失效。

**推断根因**:fork 的 Chromium 未向 Blink 上报设备能力(设备枚举缺失)。

## 2. hidden 的 WebContentsView 仍参与命中测试(输入死区)

**现象**:窗口内含多个 WebContentsView 时,`visible=false` 的 view 仍拦截系统输入(鼠标/触屏),事件在壳层凭空消失;**CDP 合成输入(`Input.dispatchMouseEvent`)不受影响** —— 后者走 Chromium 内部路径,不代表真实输入链路。

**复现要点**:
1. 窗口 contentView 挂两个 WebContentsView,A 可见、B hidden,二者 bounds 重叠;
2. 用系统级注入(非 CDP)点击落在重叠区 → 事件被 B 吞掉;
3. 把 B 的 bounds 移出屏幕后,事件正常抵达 A。

**注入侧观察**:两个 view 均挂 pointerdown 监听,活区事件正确抵达(clientX 映射无损)、死区事件完全不触发。

**绕行(已验证)**:周期扫描把 `getVisible()===false` 的 view `setBounds` 移出屏幕(如 `x:-30000`);activateTab 恢复时会重设 bounds,不冲突。

## 3. `dialog.showSaveDialog` 的 `defaultPath` 不预填文件名

**现象**:传入 `defaultPath`(含目标文件名)后,系统保存面板打开但文件名输入框为空。

**已定位范围**:fork 的 `file_dialog_ohos.cc` 确实接收了 `default_path` 并做 path→URI 转换(约 54-78 行),故**断点不在"没传"**,而在 adapter→系统 picker 的参数映射层(预填文件名通常需 picker 侧 `newFileNames` 类参数;该层为预编译 `libadapter.so`,源码不可见)。

## 4. `setTitleBarOverlay` 与 WCO 数据缺失

**现象**:
- `win.setTitleBarOverlay(...)` 无实现(调用无效果/不可用);
- 随之而来,**CSS `env(titlebar-area-x/width/...)` 无值** —— 依赖 WCO 变量的应用(Chromium 官方推荐的无边框窗口避让方式)拿不到系统按钮区几何,自绘控件会与系统按钮重叠。

**影响**:`titleBarStyle:'hidden'` 类应用无法获得"系统按钮 + 正确避让";需应用侧自行补位(本项目做法:按 `windowTitleButtonRectChange` 的矩形注入等效 CSS)。

**注**:macOS 专用的 `setWindowButtonVisibility/Position` 与 Win/Linux 的 `setTitleBarOverlay` 是两套机制,此处缺的是后者。

## 5. `webContents.print()` 无实现

**现象**:`apps/*/src/main` 中四处打印调用(`docs`、`sheets`、`slides`、`pdf`)在 fork 上无对应实现(PrintAdapter TODO),打印链路不可用。

**影响**:文档"打印"功能失效;可用 `printToPDF`(已支持)降级为"导出 PDF"。

## 6. 触摸设备上 canvas 自绘网格的输入交互失效(同包 2in1 正常)

**现象**:同一 HAP,sheets(Univer 自绘 canvas 网格)在**触摸设备(平板)**上网格点击/拖拽
完全失效——选中单元格不动、无法编辑;同页面 **DOM 内容触摸正常**(tab 条、TipTap 编辑器
tap 聚焦、工具栏按钮 tap 生效、PDF 触摸滚动均正常)。**2in1(PC,无触摸)上同一交互正常**。
CDP 合成鼠标事件在两台设备上均派发成功,但只在 PC 上改变网格状态。

**取证(平板,系统级触摸注入 `uinput -T`,两轮独立复测)**:

```
事件链探针(document capture):touchstart → pointerdown(pointerType=touch)
  → mousedown → click 全部抵达网格 canvas,isTrusted=true
落点校验:WebContentsView 内嵌文档模块的屏幕原点在 tab 条下方(Y 偏移已标定补偿),
  补偿后 clientX/Y 与目标网格坐标精确一致,elementFromPoint 命中主网格 canvas
结果:Univer 选区不变(点击前后截屏对照);同操作 CDP dispatchMouseEvent 也派发成功,同样不变
焦点链(重点):FOCUSIN(ribbon AI 按钮) → FOCUSIN(canvas#univer-sheet-main-canvas,tabindex=1)
  → FOCUSIN(DIV#__editor___INTERNAL_EDITOR__DOCS_NORMAL)
  —— 最后一环是 Univer 的内部单元格编辑器容器,即 Univer 自身的焦点流程走到了
  "内部编辑器获焦",但选区更新/编辑态建立没有继续;系统软键盘因此误弹
  (该 DIV 可聚焦,系统按文本输入唤起键盘)
对照:同页 HTML 按钮 tap → click 派发且业务生效;TipTap 正文 tap 聚焦、工具栏加粗 tap 生效
对照:slides(Konva,同为 canvas 自绘,消费 pointer/touch 原生事件)触摸选中图形、
  拖拽元素人工实测正常 —— 排除"canvas 自绘整体失效",坏点窄化为
  "合成 mouse 事件的细节属性/序列与真鼠标不一致,Univer 状态机对此敏感"
对照:PC(2in1,非触摸)上 CDP 鼠标点击网格 → 选区正常跳转(如 G16)
其他:navigator.maxTouchPoints=0(平板页面中),与回馈 #1 的能力上报缺失一致
```

**已排除的应用侧自救(实测证伪)**:在页面加载前注入 `maxTouchPoints=5`、
`'ontouchstart' in window`、`TouchEvent/Touch/TouchList` 补丁(补偿回馈 #1 的能力
上报缺失),注入确认生效(`navigator.maxTouchPoints===5`)后复测——点击网格选区
依旧不动。**Univer 的失效不(只)由能力上报缺失驱动**,应用侧补上报救不回来。

**决定性对照(定性关键,双向)**:同一台平板、同一个 Univer 官方 demo 页
(office.univer.ai showcase,Univer 住于同源 iframe):

```
① 系统浏览器(华为浏览器,非 fork 引擎):触摸点击网格 → 选区正常跳转、可进编辑
   (人工实测 + 系统触摸注入双重确认) —— Univer 触屏支持本身没问题
② fork 引擎内(经应用文档 view 导航到同一 URL):iframe 内探针显示事件全链
   (touchstart→pointerdown→mousedown→click)以精确坐标、isTrusted=true 抵达
   Univer 网格容器;但行为错乱 —— 点击网格中部某格,Univer 却进入"当前默认格(A1)
   的编辑态"(公式条出现取消/确认按钮与编辑光标),选区不跳转
③ 应用内 GenOffice sheets 的表现与 ② 同款:软键盘误弹即"编辑态被误触发",
   焦点链同样走到 Univer 容器/内部 DIV 后即停
```

**定性:fork 侧问题铁案(双向对照,排除 GenOffice 集成层与 Univer 版本变量)**。
同一 demo 页面唯一差异是浏览器引擎;点击某格被处理成对当前格的编辑,选区不跳转。
Konva 等只消费坐标的 canvas 库不受影响。

**事件层已查清(合成事件本身正常)**:iframe 内探针逐项核对——clientX/Y 精确、
screenX/Y 换算正确(screenY×dpr=注入物理坐标)、offsetX/Y 与 pageX/Y 自洽、
click.detail=1、buttons 正确、pointerId/pointerType 正常、isTrusted=true、
时序为标准的 pointerup→mousedown→mouseup→click;CDP 内部通道合成的鼠标事件
(pointerType=mouse,不经触摸桥接层)同样完整到达网格 canvas,Univer 同样不消费。
(Univer 内部会对容器收到的 pointerdown 向 canvas 重派发一次 isTrusted=false
的转发,非 fork 重复派发。)

**现象边界(重要)**:用户外接鼠标实测,pad 上表格网格**鼠标同样无法操作**
——失效与输入类型无关(触摸/外接鼠标/CDP 合成全灭),是 tablet 形态下
网格输入消费的整体失效。PC(2in1) 真鼠标一切正常。

**已逐项排除的假设(均为实测,供 fork 侧缩小范围)**:
- 设备能力伪装:JS 层全量伪造(pointer:coarse/hover:none 的 matchMedia hook、
  maxTouchPoints=5、ontouchstart、TouchEvent)后 Univer 仍失效
  —— 注:matchMedia 能力上报缺失(#1)仍成立,但不是本条的门卫
- rAF 停摆:两端均 60fps 正常
- Page Visibility:两端均出现 visibilityState=hidden 的怪癖(波动),
  但 PC 输入正常,与失效不相关
- 双击误判(click.detail 累积)、事件重复派发(isTrusted 区分后排除)
- dpr 坐标换算:canvas backing/client 比率与 dpr 自洽

**当前定性**:tablet 形态下,事件以正常形态到达页面 canvas 而 Univer 状态机
不消费,输入类型无关;机制在页面可观察面之外,需 fork 侧对照同页 ArkWeb
(正常)与 fork(失效)的输入管线内部状态排查。应用侧已无可行自救
(伪装/翻译/内部合成全试)。
