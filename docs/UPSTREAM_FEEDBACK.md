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
完全失效——选中单元格不动、无法编辑;同页面 **HTML 控件触摸正常**(tab 条 tap 的 click
正常派发并生效)。**2in1(PC,无触摸)上同一交互正常**。CDP 合成鼠标事件在两台设备上
均派发成功,但只在 PC 上改变网格状态。

**取证(平板,系统级触摸注入 `uinput -T`)**:

```
事件链探针(document capture):touchstart → pointerdown(pointerType=touch)
  → mousedown → click 全部抵达目标 canvas,isTrusted=true
落点校验:elementFromPoint 与 canvas.getBoundingClientRect() 吻合,无坐标错位
结果:Univer 选区不变;同操作 CDP dispatchMouseEvent 也派发成功,同样不变
对照:同页 HTML 按钮 tap → click 派发且业务生效(切换 tab 成功)
对照:PC(2in1,非触摸)上 CDP 鼠标点击网格 → 选区正常跳转(如 G16)
其他:navigator.maxTouchPoints=0(平板页面中),与回馈 #1 的能力上报缺失一致
```

**推断**:触摸设备上 Chromium 的事件合成/派发路径与 Univer 自绘输入层的某处不兼容
(能力上报缺失 #1 与本条可能同源——页面拿不到真实输入形态)。应用侧无法绕过:
事件以正确坐标到达 canvas,Univer 不消费。需 fork 侧排查触摸路径的事件构造
(或与 #1 一并修能力上报后复测)。
