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
| 6 | 平板上 canvas 自绘网格(如 Univer)的输入消费失效(输入类型无关) | 实测(含双向对照与事件链探针) | 高:表格在平板上不可用(触摸与鼠标均失效) |

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

## 6. 平板(tablet)上 canvas 自绘网格的输入消费失效(输入类型无关;同包 2in1 正常)

**现象**:同一 HAP,sheets(Univer 自绘 canvas 网格)在平板上网格**无法选中/编辑单元格**,
与输入类型无关——触摸、外接鼠标、CDP 内部合成鼠标(不经触摸桥接层)全部失效;
各输入方式的事件全链(touchstart→pointerdown→mousedown→click,或 mouse 对应链)
以精确坐标、isTrusted=true 抵达网格 canvas,事件属性逐项正常(clientX/Y、screenX/Y、
offsetX/Y、click.detail、buttons、pointerId、合成时序),Univer 状态机不消费。
同页 DOM 内容输入全部正常(按钮/编辑器聚焦/工具栏/滚动);slides(Konva)触摸选中、
拖拽正常;**2in1(PC)上一切正常**。

**双向对照(排除应用层与 Univer 本身)**:同一台平板、同一个 Univer 官方 demo 页
(office.univer.ai):

```
系统浏览器(华为浏览器,非 fork 引擎):触摸选中/编辑正常(人工实测 + 系统触摸注入双确认)
fork 引擎内(应用文档 view 导航到同一 URL,无任何应用代码):事件全链正常抵达,
  但点击网格被错处理成"对当前格的编辑",选区不跳转
```

**已实测排除(供 fork 侧缩小范围)**:

- 事件构造:坐标/detail/buttons/pointerId/pointerType/时序/派生坐标全部正常;
  Univer 对容器 pointerdown 的 canvas 重派发(isTrusted=false)属内部转发,非重复派发
- 设备能力上报缺失(见 #1):JS 层全量伪造(matchMedia hook、maxTouchPoints、
  ontouchstart、TouchEvent)并确认生效后仍失效——#1 成立但不是本条门卫
- rAF 停摆(两端均 60fps)、Page Visibility(两端均有 hidden 波动怪癖,PC 输入正常,
  与本条不相关)、dpr 坐标换算(canvas backing/client 与 dpr 自洽)
- 应用侧自救:事件翻译/内部合成均不可行(pad 上 CDP 合成鼠标同样不被消费)

**定性**:tablet 形态下,事件以正常形态到达页面 canvas 而 Univer 状态机不消费,
输入类型无关;机制在页面可观察面之外。建议 fork 侧以"同页 ArkWeb 正常 / fork 失效"
为最小复现,排查 tablet 形态输入管线的内部状态(焦点/激活/可见性在 widget 层的
传递)。环境:OHOS API 26 / Matrix pad / electron-v37.2.0-openharmony,
系统触摸注入 uinput -T/-M,页面探针 document capture。
