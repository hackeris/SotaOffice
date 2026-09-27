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
| 6 | UA 注入设备类型标记(TABLET),按 UA 判设备类型的页面输入不被消费 | 实测 + 源码 | 高:应用侧一行可规避(已落地) |

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

## 6. UA 注入设备类型标记(TABLET),按 UA 判设备类型的页面输入不被消费

**现象**:同一 HAP,sheets(Univer 自绘 canvas 网格)在平板上网格**无法选中/编辑单元格**,
触摸、外接鼠标、CDP 内部合成鼠标一致失效;2in1(PC)一切正常。事件全链
(touchstart→pointerdown→mousedown→click)以精确坐标、isTrusted=true 抵达网格 canvas,
属性逐项正常,页面状态机不消费。同页 DOM 输入全部正常;不做 UA 设备分支的 canvas
库(如 Konva)触摸正常。

**根因(源码 + 翻转实测,双实锤)**:fork 按 `OH_GetDeviceType()` 拼 UA
(`GetOhosDeviceType()`:2in1→`PC;`,tablet→`TABLET;`,phone→`PHONE;`)。Univer 按 UA
判设备类型,tablet 分支在本引擎不消费输入。同机同页同输入通道(CDP 合成鼠标),
唯一变量是 UA 里的设备标记:

```
UA (OHOS; TABLET; …) → 点网格:选区不跳转(复现)
UA (OHOS; PC; …)     → 点网格:选区跳转(恢复)
UA 翻回 TABLET → 不跳转;再翻回 PC → 恢复(可逆)
```

真实触摸链同步验证:UA=PC 时,uinput 系统触摸注入(应用前台)的
touch→pointer→mouse→click 全链正常抵达且被消费,选区正确跳转。

**旁证(与相邻缺陷的关系)**:

- 与输入管线无关——CDP 内部合成鼠标(不经触摸桥接层)同样随 UA 翻转失效/恢复;
  UA 在页面加载时即定型,故输入类型无关
- 与 #1(设备能力上报缺失)相互独立——JS 层全量伪造能力(matchMedia/maxTouchPoints/
  TouchEvent,不伪造 UA)不恢复;仅翻转 UA 即恢复

**应用侧规避(已落地)**:Electron 标准 API 一行——`app.userAgentFallback` 把
`TABLET;` 替换为 `PC;`(仅在 UA 含该标记时,2in1 无感)。桌面指针假设的应用报
桌面身份,语义一致,无副作用。

**建议 fork 侧**:审视 UA 拼接的设备类型注入策略。页面生态(ua-parser 类)把
TABLET 当作「触摸优先交互」分支的开关,而本引擎实际给页面的是合成鼠标事件 +
无触摸能力上报(见 #1),tablet 分支在此环境必然半残。要么 tablet 不注入设备
标记,要么提供应用可控的开关,并把该行为写进移植文档。环境:OHOS API 26 /
Matrix pad / electron-v37.2.0-openharmony,系统触摸注入 uinput -T,
页面探针 document capture。
