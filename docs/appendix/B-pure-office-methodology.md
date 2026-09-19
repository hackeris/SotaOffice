# 附录 B:Pure Office(ONLYOFFICE 鸿蒙移植)方法论摘要

> 来源:2026-09-19 对 `/data/share/office` 的深度调研(135 commit,已产品化 1.0.46,真机 MateBook Pro)。该走 **B 路线**(ArkTS 壳 + ArkWeb + x2t NAPI),对本项目的价值是**方法论与工具链资产**,以及 A/B 路线的选型判据。

## 1. 它的架构(为什么与我们不同)

ArkTS 薄壳(ArkUI)包系统 ArkWeb 渲染 ONLYOFFICE web-apps/sdkjs;C++ core(x2t)静态链进单个 NAPI .so(103MB)做格式转换。选型记录在 `docs/ONLYOFFICE_OHOS_PORT_DESIGN.md`:鸿蒙无应用可链接的独立 libcef,应用态嵌 Chromium 的两条可行路径之一就是 openharmony-sig/electron(另一条 pc_chromium_132);对 ONLYOFFICE 判定"自编译 Chromium(>200G 磁盘/>32G 内存)+ 每版本跟踪上游"不划算——**但它同时留下判据:深度依赖 Node 主进程/Electron API 面的应用,Electron 路线可能反而省**。GenOffice 采纳此判据走了 A 路线。

## 2. 对本项目可复用的资产

| 资产 | 位置 | 复用方式 |
|---|---|---|
| 交叉编译工具链 | `scripts/onlyoffice/core3d/ohos-arm64.toolchain.cmake`(BiSheng clang,`--target=aarch64-linux-ohos --sysroot=$NDK/sysroot`) | 任何 C/C++ 依赖交叉编译模板;NDK 本机在 /data/share/ohos-sdk |
| 一键部署验收链 | `scripts/onlyoffice/deploy_ohos.sh`(装配→hvigor→hdc install→重启→探针;**hdc install 失败 rc 仍为 0,必须匹配输出文本**;`set -eo pipefail`) | 直接套用为 genoffice-ohos 的 deploy 脚本模式 |
| hvigor 工程骨架 | `build-profile.json5.template`(签名不入库)、单 entry 模块、ohpm file: 本地包装 .so | entry 模块模板 |
| 文件关联 skills 声明 | `module.json5`:`ohos.want.action.viewData` + entities 留空 + UTD 逐条枚举 + linkFeature FileOpen | GenOffice 的 .docx/.xlsx/.pptx/.pdf/.md/.html 关联 |
| 文档方法论 | PORT_DESIGN(选型+POC)→ KEYPOINTS(不可变决策+踩坑)→ FEATURE_MATRIX(能力矩阵+验收记录) | 本目录同名文档沿用此结构 |
| 打印链 | `print.print([FileUri])`(@ohos.print,system_grant 声明即得;跨进程必须 fileUri.getUriFromPath) | M1 打印备用方案(printToPDF 不可用时) |
| 窗口/设备形态 | `setWindowDecorVisible(false)` 只藏标题栏(系统三键仍在);`deviceInfo.deviceType` 不反映 PC 模式切换;PC 放大用 ArkUI scale | 触屏/形态适配时参考 |

## 3. 必须遵守的经验(踩坑精选)

- 构建纪律:所有生成物不入库 + 一键重生成 + `--rebuild` 毁灭性演练 + 版本号单一数据源(AppScope/app.json5);`hvigorw clean` 会删 native 产物;`.ets` 增量可能不刷新(`strings HAP | grep 新串` 验包)。
- 诊断体系先行:统一日志落盘(不依赖 hilog 抓 web console)、启动参数门控验收(产品态零测试痕迹)、探针自检全绿日志。
- 官方语义优先:降级按官方契约(false/''/0/[])让 UI 自动隐藏入口;不伪造宿主身份。
- 二进制铁律(若走 ArkWeb 桥):Uint8Array 而非 binary string;base64 信封;`runJavaScript` 返回值 JSON 编码。——A 路线下主进程内 IPC 原生工作,多数不适用,但 hdc/签名/形态类全部适用。
- release/debug 签名互不能覆盖安装(`sign info inconsistent`);多设备 hdc 必须 `-t`。
