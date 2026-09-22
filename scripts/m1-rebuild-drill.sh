#!/bin/bash
# m1-rebuild-drill.sh —— 毁灭性重建演练(构建可复现性证明)
#
# 正确命令:bash scripts/m1-rebuild-drill.sh
# 前置:thirdparty/genoffice 七 out 产物在位(三脚本只做组装/打包,不重编译 GenOffice);
#       真实从零还需先在 thirdparty/genoffice 里 npm ci + npm run build:all(耗时长,日常演练不触发)。
# 动作:删除全部可重建产物(引擎二进制/组装产物/构建目录/profile)
#       → sync-engine → build-genoffice --no-build → build-ohos → 产物断言
# 注意:只删**可重建产物**;web_engine 的 ets/cpp 适配层与 module.json5 自有化入库,
#       不删(删了 sync-engine 不恢复它)。
# 输出:全绿 = 可复现;任何一步失败非零退出(脚本可 tee 落盘后 grep 复盘)
set -eo pipefail
cd "$(dirname "$0")/.."

# 可重建产物清单(与 .gitignore 的忽略项一致)
TARGETS="web_engine/libs web_engine/build web_engine/oh_modules \
entry/libs entry/build entry/src/main/resources/resfile/resources \
build-profile.json5"

echo "==> [1/6] 毁灭性删除可重建产物"
rm -rf $TARGETS

echo "==> [2/6] 断言:删除已生效 + 自有化源码完好"
for p in $TARGETS; do
  if [ -e "$p" ]; then echo "  FAIL: $p 仍存在"; exit 1; fi
done
# 防线:自有化适配层绝不能被误删(sync-engine 不恢复它,只有 git 能)
for f in web_engine/oh-package.json5 web_engine/src/main/module.json5 web_engine/src/main/ets/ability/WebAbility.ets; do
  [ -f "$f" ] || { echo "  FAIL: 自有化源码缺失 $f(演练误删?git checkout 恢复)"; exit 1; }
done
echo "  产物已删 / 源码完好 ✓"

echo "==> [3/6] sync-engine(引擎二进制组装 + entry libs 必需件)"
bash scripts/sync-engine.sh

echo "==> [4/6] build-genoffice --no-build(产物组装 + 断言)"
bash scripts/build-genoffice.sh --no-build

echo "==> [5/6] build-ohos(权限校验 + hvigor 打包;有签名素材则签名,sotaoffice profile 未到位 → unsigned)"
bash scripts/build-ohos.sh

echo "==> [6/6] 最终产物断言"
HAP=$(ls entry/build/default/outputs/default/entry-default-*.hap 2>/dev/null | head -1)
[ -n "$HAP" ] || { echo "  FAIL: HAP 不存在"; exit 1; }
SIZE=$(stat -c %s "$HAP")
if [ "$SIZE" -lt 300000000 ]; then echo "  FAIL: HAP $SIZE < 300MB 阈值"; exit 1; fi
echo "  HAP $HAP ${SIZE} bytes ✓"
echo "==> 演练全绿:从零重建可复现 ✓"
