#!/bin/bash
# release 上架包一键构建(配置换入/还原模式,参照 wineohos/qemuohos 发布流程)
#
# 正确命令:bash scripts/build-release.sh
# 正确目录:仓库根(脚本内部自行 cd)
# 前提:    .ohos/build-profile.release.json5(gitignore:发布签名配置,材料在
#          /data/share/hap/.ohos/prod/;换机器发布需同步该目录与配置文件)
# 链路:    备份 build-profile.json5 与 web_engine/BuildProfile.ets(hvigor 按构建
#          模式自动改写后者,不还原会污染工作树)→ 换入 release 配置 → hvigorw
#          assembleApp(--mode project;签名由 hvigor SignHap/SignApp 任务自动完成)
#          → 还原备份(构建失败/中断也会还原,见 trap)
# 产物:    build/outputs/release/*-release-signed.app(上传 AGC 的包)
# 注意:    ① debug 与 release 签名不同,同一设备互装属「签名变更」,须先卸载旧包;
#          ② AGC 要求 versionCode 单调递增,发布前确认 AppScope/app.json5 已递增;
#          ③ Ctrl-C(SIGKILL)强杀时 trap 不保证执行,手动恢复:
#             mv .ohos/pack-bak.json5 build-profile.json5
#             mv .ohos/prof-bak.ets web_engine/BuildProfile.ets
#             (build-profile.json5 缺失时 build-ohos.sh 也会自动重建,兜底无虞)
set -eo pipefail

cd "$(dirname "$0")/.."
HVIGORW="${OHOS_HVIGORW:-/apps/harmony/bin/hvigorw}"
REL_CFG=".ohos/build-profile.release.json5"
BAK=".ohos/pack-bak.json5"
PROF="web_engine/BuildProfile.ets"
PROF_BAK=".ohos/prof-bak.ets"
LOG=/tmp/smartoffice-release-build.log

[ -x "$HVIGORW" ] || { echo "FATAL: hvigorw 不可用: $HVIGORW(当前环境应是 hoa 容器)" >&2; exit 1; }
[ -f "$REL_CFG" ] || { echo "FATAL: 缺 $REL_CFG(发布签名配置,gitignore 区)" >&2; exit 1; }

# 备份/还原:build-profile.json5 是 build-ohos.sh 的生成物,缺失属正常态
HAD_PROFILE=0
[ -f build-profile.json5 ] && HAD_PROFILE=1
HAD_PROF=0
[ -f "$PROF" ] && HAD_PROF=1
RESTORED=0
restore() {
  [ "$RESTORED" = 1 ] && return
  RESTORED=1
  if [ "$HAD_PROFILE" = 1 ]; then
    if [ -f "$BAK" ]; then
      mv "$BAK" build-profile.json5
    else
      echo "WARN: 备份 $BAK 意外丢失,调试配置未还原(手动检查)" >&2
    fi
  else
    rm -f build-profile.json5
  fi
  if [ "$HAD_PROF" = 1 ] && [ -f "$PROF_BAK" ]; then
    mv "$PROF_BAK" "$PROF"
  fi
  echo "==> 调试配置已还原(缺失态则留待下次构建自动重建)"
}
trap restore EXIT

echo "==> [1/2] 换入 release 配置($REL_CFG → build-profile.json5;原调试配置已备份)"
[ "$HAD_PROFILE" = 1 ] && cp build-profile.json5 "$BAK"
[ "$HAD_PROF" = 1 ] && cp "$PROF" "$PROF_BAK"
cp "$REL_CFG" build-profile.json5

echo "==> [2/2] hvigorw assembleApp(product=release, buildMode=release)"
# assembleApp 是工程级任务,须 --mode project(--mode module 下报 "Task 'assembleApp' was not found")
"$HVIGORW" assembleApp --mode project -p product=release -p buildMode=release --no-daemon \
  2>&1 | tee "$LOG" | grep -E "^> hvigor.*(ERROR|BUILD (SUCCESSFUL|FAILED))" | tail -8

restore
trap - EXIT
echo "==> 构建通过:$(ls build/outputs/release/*signed*.app 2>/dev/null | head -1)"
echo "    (与 debug 包签名不同,同机互装须先卸载;上传 AGC 前确认 versionCode 已递增)"
