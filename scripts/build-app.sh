#!/bin/bash
# build-app.sh —— 组装自检 app 资产(sidecar / wasm / icon)到工程内(幂等,可重复执行)
#
# 正确命令:bash scripts/build-app.sh
# 正确目录:genoffice-ohos 仓库根(脚本内部自行定位)
# 产物:    entry/libs/arm64-v8a/xlsx-sidecar(executableBinaryPaths 已注册)
#          entry/src/main/resources/resfile/resources/app/wasm/{pdfium.wasm,pdfium.cjs}
#          entry/src/main/resources/resfile/resources/app/icon.png
# 来源(M1 固化时这些路径将换成 genoffice 仓正式构建产物):
#   - sidecar:POC-4 交叉编译产物(aarch64-unknown-linux-ohos + crt-static,NDK CC 链)
#   - wasm:   genoffice-e37 node_modules @embedpdf/pdfium@2.15.1 dist(POC-5 验证版本)
# 断言:     全部件存在 + sidecar 为 aarch64 ELF 且静态(无 INTERP)——动态链接版本在 OHOS 上起不来
set -eo pipefail

DST="$(cd "$(dirname "$0")/.." && pwd)"
E37="${GENOFFICE_E37:-/data/share/smartoffice/.temp/genoffice-e37}"
APP="$DST/entry/src/main/resources/resfile/resources/app"

SIDECAR_SRC="$E37/apps/sheets/native/xlsx-engine/target/aarch64-unknown-linux-ohos/release/xlsx-sidecar"
PDFIUM_DIR="$E37/node_modules/@embedpdf/pdfium/dist"

echo "==> [1/3] sidecar → entry/libs/arm64-v8a/(executableBinaryPaths 注册位)"
[ -f "$SIDECAR_SRC" ] || { echo "FATAL: sidecar 不存在: $SIDECAR_SRC(先跑 POC-4 交叉编译)" >&2; exit 1; }
file "$SIDECAR_SRC" | grep -q "ELF 64-bit.*ARM aarch64" || { echo "FATAL: sidecar 非 aarch64 ELF" >&2; exit 1; }
if readelf -l "$SIDECAR_SRC" 2>/dev/null | grep -q INTERP; then
  echo "FATAL: sidecar 含 INTERP(动态链接,缺 lld 会在 OHOS 起不来;应 crt-static)" >&2; exit 1
fi
cp -f "$SIDECAR_SRC" "$DST/entry/libs/arm64-v8a/xlsx-sidecar"
chmod +x "$DST/entry/libs/arm64-v8a/xlsx-sidecar"

echo "==> [2/3] wasm 三件之 pdfium → app/wasm/"
mkdir -p "$APP/wasm"
[ -f "$PDFIUM_DIR/pdfium.wasm" ] || { echo "FATAL: pdfium.wasm 不存在: $PDFIUM_DIR" >&2; exit 1; }
cp -f "$PDFIUM_DIR/pdfium.wasm" "$APP/wasm/"
cp -f "$PDFIUM_DIR/index.cjs" "$APP/wasm/pdfium.cjs"

echo "==> [3/3] icon + 验收断言"
cp -f "$DST/entry/src/main/resources/base/media/app_icon.png" "$APP/icon.png"
for f in "$APP/package.json" "$APP/main-shim.mjs" "$APP/main.mjs" "$APP/preload.js" "$APP/index.html" \
         "$APP/icon.png" "$APP/wasm/pdfium.wasm" "$APP/wasm/pdfium.cjs" \
         "$DST/entry/libs/arm64-v8a/xlsx-sidecar"; do
  [ -s "$f" ] || { echo "FATAL: 缺件 $f" >&2; exit 1; }
done
SZ=$(stat -c%s "$APP/wasm/pdfium.wasm")
[ "$SZ" -gt 1000000 ] || { echo "FATAL: pdfium.wasm 异常($SZ bytes)" >&2; exit 1; }
ls -la "$APP/" "$APP/wasm/" | head -20
echo "==> app 资产组装完成"
