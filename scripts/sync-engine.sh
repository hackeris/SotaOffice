#!/bin/bash
# sync-engine.sh —— 组装 Electron-OHOS 引擎件到本工程(幂等,可重复执行)
#
# 正确命令:bash scripts/sync-engine.sh [引擎源目录]
# 正确目录:仓根(脚本内部自行定位)
# 产物:    web_engine/ HAR(libs+resfile+ets 引擎层) + entry/libs/arm64-v8a 启动器
# 用法:    引擎源有更新(版本升级)后重跑本脚本再构建
#
# 【引擎件来源(架构)】正式依赖 = thirdparty/electron(electron 本体 fork submodule,
# 分支 electron-v37.2.0-openharmony)。本脚本当前消费的 engine-ref 只是**集成方式
# 参考源**(HAR 目录结构/启动器清单/ets 引擎层级),其二进制产物不得作为交付来源。
# electron 本体产物应为 fork 构建输出(src/out/musl_64:libelectron.so/libffmpeg.so/
# libadapter.so/electron/icudtl.dat/v8_context_snapshot.bin/resources.pak/locales 等,
# 见其 README"输出结果"节);产物就绪后本脚本改为 [产物目录] 输入组装 HAR,
# 或由 fork CI 直接产出 HAR。—— 待办见 docs/PORT_DESIGN.md 引擎件来源节
#
# 同步范围(依据 docs/ELECTRON_OHOS_CHECKLIST.md §11 筛除结论):
#   1. web_engine/ 整体(rsync --delete 与源保持一致):
#      libs 三件套(libelectron/libadapter/libffmpeg)+ resfile 资源(pak/icudtl/snapshot/locales/vulkan)
#      + ets 引擎层(WebAbility/WebAbilityStage/43 adapter/jsbindings,零改动整体搬用)
#   2. entry libs 必需件(GenOffice 裁剪后):
#      electron 启动器(appspawn fork 目标)/ node 启动器(utilityProcess/MCP 生态预留)
#      / libc++_shared.so / dev_config.json(libadapter 硬编码读取,9333 远程调试开关)
#   【不搬】bash/zsh/rg(GenOffice 无 CLI 工具)、8 组 .node+.so 别名(零 napi 模块)、
#      crash-hook(POC 阶段 shim-log 够用,遇 fork 崩溃无栈时再加)
#
# 踩坑记录:
#   - web_engine resfile 里自带一份 electron 启动器(与 entry libs 同 BuildID 双份),整体 rsync 即可,勿手工精简
#   - dev_config.json 必须在 entry libs(libadapter.so 硬编码读 /data/storage/el1/bundle/libs/arm64/dev_config.json),
#     放 resfile 无效(清单 H3)
#   - 运行期落盘路径是 libs/arm64(无 -v8a),本脚本只管源布局,路径规则见清单 §0
set -eo pipefail

SRC="${1:-/data/share/smartoffice/thirdparty/engine-ref}"
DST="$(cd "$(dirname "$0")/.." && pwd)"

[ -d "$SRC/web_engine" ] || { echo "FATAL: 源不存在: $SRC/web_engine" >&2; exit 1; }

echo "==> [1/3] 同步 web_engine HAR(先清后拷,等效 rsync --delete;容器无 rsync)"
rm -rf "$DST/web_engine"
mkdir -p "$DST/web_engine"
cp -a "$SRC/web_engine/." "$DST/web_engine/"

echo "==> [2/3] 同步 entry libs 必需件"
mkdir -p "$DST/entry/libs/arm64-v8a"
for f in electron node node.c libc++_shared.so dev_config.json; do
  [ -f "$SRC/electron/libs/arm64-v8a/$f" ] || { echo "FATAL: 源缺件 $f" >&2; exit 1; }
  cp -f "$SRC/electron/libs/arm64-v8a/$f" "$DST/entry/libs/arm64-v8a/"
done

echo "==> [3/3] 验收断言"
[ -f "$DST/web_engine/libs/arm64-v8a/libelectron.so" ] || { echo "FATAL: libelectron.so 缺失" >&2; exit 1; }
SZ=$(stat -c%s "$DST/web_engine/libs/arm64-v8a/libelectron.so")
[ "$SZ" -gt 100000000 ] || { echo "FATAL: libelectron.so 异常($SZ bytes,疑似 LFS 指针未拉取)" >&2; exit 1; }
for f in libadapter.so libffmpeg.so; do
  [ -s "$DST/web_engine/libs/arm64-v8a/$f" ] || { echo "FATAL: $f 缺失" >&2; exit 1; }
done
for f in resources.pak icudtl.dat v8_context_snapshot.bin snapshot_blob.bin; do
  [ -s "$DST/web_engine/src/main/resources/resfile/$f" ] || { echo "FATAL: resfile/$f 缺失" >&2; exit 1; }
done
[ "$(stat -c%s "$DST/web_engine/src/main/resources/resfile/icudtl.dat")" -gt 1000000 ] || { echo "FATAL: icudtl.dat 异常(疑似 LFS 指针)" >&2; exit 1; }
ls -la "$DST/entry/libs/arm64-v8a/"
du -sh "$DST/web_engine/"
echo "==> 同步完成"
