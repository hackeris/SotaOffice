#!/bin/bash
# m1-rebuild-drill.sh —— M1 毁灭性重建演练(构建可复现性证明,G6 收尾项)
#
# 正确命令:bash scripts/m1-rebuild-drill.sh
# 前置:thirdparty/genoffice 七 out 产物在位(三脚本只做同步/组装/打包,不重编译 GenOffice);
#       真实从零还需先在 thirdparty/genoffice 里 npm ci + npm run build:all(耗时长,日常演练不触发)。
# 动作:rm web_engine/oh_modules/entry/build/resfile/resources/build-profile.json5
#       → sync-engine → build-genoffice --no-build → build-ohos → 产物断言
# 输出:全绿 = 可复现;任何一步失败非零退出(脚本可 tee 落盘后 grep 复盘)
set -eo pipefail
cd "$(dirname "$0")/.."

echo "==> [1/6] 毁灭性删除(web_engine oh_modules entry/build resfile/resources build-profile.json5)"
rm -rf web_engine oh_modules entry/build entry/src/main/resources/resfile/resources build-profile.json5

echo "==> [2/6] 断言:删除已生效"
for p in web_engine oh_modules entry/build entry/src/main/resources/resfile/resources build-profile.json5; do
  if [ -e "$p" ]; then echo "  FAIL: $p 仍存在"; exit 1; fi
done
echo "  全部已删 ✓"

echo "==> [3/6] sync-engine(HAR 同步 + entry libs 必需件)"
bash scripts/sync-engine.sh
test -f web_engine/oh-package.json5 || { echo "  FAIL: web_engine 未恢复"; exit 1; }
echo "  web_engine 已恢复 ✓"

echo "==> [4/6] build-genoffice --no-build(产物组装 + 31 件断言)"
bash scripts/build-genoffice.sh --no-build

echo "==> [5/6] build-ohos(hvigor 打包 + 签名)"
bash scripts/build-ohos.sh

echo "==> [6/6] 最终产物断言"
HAP=entry/build/default/outputs/default/entry-default-signed.hap
test -f "$HAP" || { echo "  FAIL: HAP 不存在"; exit 1; }
SIZE=$(stat -c %s "$HAP")
if [ "$SIZE" -lt 300000000 ]; then echo "  FAIL: HAP $SIZE < 300MB 阈值"; exit 1; fi
echo "  HAP $(dirname $HAP)/$(basename $HAP) ${SIZE} bytes ✓"
echo "==> 演练全绿:从零重建可复现 ✓"
