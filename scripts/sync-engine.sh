#!/bin/bash
# sync-engine.sh —— 组装 Electron 引擎二进制到本工程(幂等,可重复执行)
#
# 正确命令:bash scripts/sync-engine.sh [引擎产物源目录]
# 正确目录:仓根(脚本内部自行定位)
# 产物:    web_engine/libs/arm64-v8a/*.so + web_engine/src/main/resources/resfile/ 资源
#          + entry/libs/arm64-v8a 启动器(electron/node/libc++_shared.so/dev_config.json)
# 用法:    引擎产物有更新(版本升级)后重跑本脚本再构建
#
# 【来源】.temp/engine-ref 不入库,clone 带不来,需要时自己拉:
#   git clone https://atomgit.com/nanqube/hos_vscodium-opensource.git .temp/engine-ref
# 它是 VSCodium 的鸿蒙移植仓,装的正是 electron-v37.2.0-openharmony 这份运行时,
# 目录布局与官方 README「输出结果」节一致,可直接取用。
#
# 另一条路是自己编译 thirdparty/electron(分支 electron-v37.2.0-openharmony,跑它
# 自带的 electron_build.sh,需拉 Chromium 138 源码,耗时长),产物落在 src/out/musl_64:
# libelectron.so / libffmpeg.so / libadapter.so / electron / icudtl.dat /
# v8_context_snapshot.bin / resources.pak / locales 等。
#
# 【不改动】web_engine 的 ets/cpp 适配层与 module.json5 已自有化入本仓(git 管理),
# 本脚本只组装二进制,绝不覆盖源码——改动适配层请直接改 web_engine/ 下文件。
#
# 组装范围:
#   1. libs 三件套(libelectron/libadapter/libffmpeg)+ resfile 资源(pak/icudtl/
#      snapshot/locales/vulkan)
#   2. entry libs 必需件:electron 启动器(appspawn fork 目标)/ node 启动器
#      (utilityProcess/MCP 生态预留)/ libc++_shared.so / dev_config.json
#   【不搬】bash/zsh/rg(GenOffice 无 CLI 工具)、.node+.so 别名(零 napi 模块)、
#      crash-hook(遇 fork 崩溃无栈时再加)
#
# 踩坑记录:
#   - dev_config.json 必须在 entry libs(libadapter.so 硬编码读
#     /data/storage/el1/bundle/libs/arm64/dev_config.json),放 resfile 无效
#   - 运行期落盘路径是 libs/arm64(无 -v8a),本脚本只管源布局
set -eo pipefail

DST="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${1:-$DST/.temp/engine-ref}"

[ -d "$SRC/web_engine/libs/arm64-v8a" ] || { echo "FATAL: 源不存在: $SRC/web_engine/libs/arm64-v8a" >&2; exit 1; }

echo "==> [1/3] 组装引擎 libs + resfile(先清后拷;ets/cpp 适配层自有化,不覆盖)"
rm -rf "$DST/web_engine/libs" "$DST/web_engine/src/main/resources/resfile"
mkdir -p "$DST/web_engine/libs/arm64-v8a" "$DST/web_engine/src/main/resources/resfile"
cp -a "$SRC/web_engine/libs/arm64-v8a/." "$DST/web_engine/libs/arm64-v8a/"
cp -a "$SRC/web_engine/src/main/resources/resfile/." "$DST/web_engine/src/main/resources/resfile/"

echo "==> [2/3] 组装 entry libs(electron 启动器 ← 引擎产物源;libc++_shared.so ← OHOS
SDK(官方指导来源);dev_config.json ← 本仓生成)"
mkdir -p "$DST/entry/libs/arm64-v8a"
for f in electron node node.c; do
  [ -f "$SRC/electron/libs/arm64-v8a/$f" ] || { echo "FATAL: 源缺件 $f" >&2; exit 1; }
  cp -f "$SRC/electron/libs/arm64-v8a/$f" "$DST/entry/libs/arm64-v8a/"
done
NDK_LIBCXX="${OHOS_NDK_LIBCXX:-/apps/harmony/sdk/default/openharmony/native/llvm/lib/aarch64-linux-ohos/libc++_shared.so}"
[ -f "$NDK_LIBCXX" ] || { echo "FATAL: SDK libc++_shared.so 不存在: $NDK_LIBCXX" >&2; exit 1; }
cp -f "$NDK_LIBCXX" "$DST/entry/libs/arm64-v8a/libc++_shared.so"
# dev_config.json:libadapter.so 硬编码读 /data/storage/el1/bundle/libs/arm64/dev_config.json
# (9333 远程调试通道开关;放 resfile 无效)
printf '%s\n' '{' '  "remote-debugging": true,' '  "remote-debugging-port": 9333' '}' \
  > "$DST/entry/libs/arm64-v8a/dev_config.json"

echo "==> [3/3] 验收断言"
[ -f "$DST/web_engine/libs/arm64-v8a/libelectron.so" ] || { echo "FATAL: libelectron.so 缺失" >&2; exit 1; }
SZ=$(stat -c%s "$DST/web_engine/libs/arm64-v8a/libelectron.so")
[ "$SZ" -gt 100000000 ] || { echo "FATAL: libelectron.so 异常($SZ bytes,疑似指针未拉取)" >&2; exit 1; }
for f in libadapter.so libffmpeg.so; do
  [ -s "$DST/web_engine/libs/arm64-v8a/$f" ] || { echo "FATAL: $f 缺失" >&2; exit 1; }
done
for f in resources.pak icudtl.dat v8_context_snapshot.bin snapshot_blob.bin; do
  [ -s "$DST/web_engine/src/main/resources/resfile/$f" ] || { echo "FATAL: resfile/$f 缺失" >&2; exit 1; }
done
[ "$(stat -c%s "$DST/web_engine/src/main/resources/resfile/icudtl.dat")" -gt 1000000 ] || { echo "FATAL: icudtl.dat 异常" >&2; exit 1; }
# 自有化适配层完整性(本脚本不写它,但构建依赖它——缺 = 仓内容残缺)
[ -f "$DST/web_engine/src/main/ets/ability/WebAbility.ets" ] || { echo "FATAL: web_engine 适配层缺失(仓内容残缺)" >&2; exit 1; }
ls -la "$DST/entry/libs/arm64-v8a/"
du -sh "$DST/web_engine/libs" "$DST/web_engine/src/main/resources/resfile"
echo "==> 组装完成"
