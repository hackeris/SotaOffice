#!/bin/bash
# build-genoffice.sh —— GenOffice 构建产物 → HAP resfile 组装管线(M1 核心)
#
# 正确命令:bash scripts/build-genoffice.sh [--src DIR] [--no-build] [--selfcheck] [--keep-maps]
# 正确目录:/data/share/smartoffice 仓库根(脚本内部自行定位)
# 产物:    entry/src/main/resources/resfile/resources/
#            app/{package.json,main-shim.mjs,out/{main(+chunks),preload×3,renderer}}
#            modules/{docs,sheets,slides,pdf,markdown,html}/{preload,renderer}/  ← 裁掉 out/main 死重
#            wasm/{pdfium,hb-subset}.wasm + THIRD-PARTY-NOTICES.txt
# 链路:    sync-engine.sh(引擎)→ 本脚本(GenOffice app)→ build-ohos.sh(HAP+断言)
# 前提:    --src 指向的 genoffice 仓在 ohos/electron37 分支(参考 e37 pin,patch 见
#          scripts/patches/genoffice-e37-pin.patch);不指定 --no-build 则跑 npm run build:all
# 断言:    main 字段/bundle>5MB/六模块 preload+renderer/死重已裁/wasm 头/无 symlink/
#          无 node_modules 无 .ts;体积 60~150M 区间外告警;失败非零退出
#
# --selfcheck:组装 scripts/selfcheck-app/(POC 已验证态)而非 GenOffice 产物——
#          A/B 排障通道:首亮失败时一键回到已知好,隔离"壳坏了"vs"产物问题"。
set -eo pipefail

cd "$(dirname "$0")/.."
SRC="/data/share/smartoffice/.temp/genoffice"
RES_DIR="entry/src/main/resources/resfile/resources"
SELFCHECK_APP="scripts/selfcheck-app"
KEEP_MAPS=0 DO_BUILD=1 MODE=genoffice
while [ $# -gt 0 ]; do
  case "$1" in
    --src) SRC="$2"; shift 2 ;;
    --no-build) DO_BUILD=0; shift ;;
    --selfcheck) MODE=selfcheck; DO_BUILD=0; shift ;;
    --keep-maps) KEEP_MAPS=1; shift ;;
    *) echo "FATAL: 未知参数 $1" >&2; exit 1 ;;
  esac
done
MODULES="docs sheets slides pdf markdown html"

echo "==> [1/4] 源校验(mode=$MODE src=$SRC)"
if [ "$MODE" = "genoffice" ]; then
  BR=$(git -C "$SRC" branch --show-current 2>/dev/null || echo none)
  [ "$BR" = "ohos/electron37" ] || { echo "FATAL: $SRC 不在 ohos/electron37 分支(当前:$BR)" >&2; exit 1; }
  grep -q '"electron": "37.2.0"' "$SRC/package.json" || { echo "FATAL: 根 package.json 未 pin electron 37.2.0" >&2; exit 1; }
  if [ "$DO_BUILD" = "1" ]; then
    echo "    npm run build:all(docs→…→cli→shell,数分钟)…"
    (cd "$SRC" && npm run build:all >/tmp/genoffice-build-all.log 2>&1) \
      || { echo "FATAL: build:all 失败(见 /tmp/genoffice-build-all.log)" >&2; exit 1; }
    echo "    build:all 完成"
  fi
  for m in $MODULES shell; do
    [ -f "$SRC/apps/$m/out/renderer/index.html" ] || { echo "FATAL: 缺 $SRC/apps/$m/out/renderer(先 build)" >&2; exit 1; }
  done
  [ -f "$SRC/apps/shell/out/main/index.js" ] || { echo "FATAL: 缺 shell out/main/index.js" >&2; exit 1; }
  [ -f "$SRC/node_modules/@embedpdf/pdfium/dist/pdfium.wasm" ] || { echo "FATAL: 缺 pdfium.wasm(npm ci)" >&2; exit 1; }
  HB=$(find "$SRC/node_modules/harfbuzzjs" -name "harfbuzz-subset.wasm" 2>/dev/null | head -1)
  [ -n "$HB" ] || { echo "FATAL: 缺 harfbuzz-subset.wasm" >&2; exit 1; }
else
  for f in package.json main-shim.mjs main.mjs preload.js index.html; do
    [ -f "$SELFCHECK_APP/$f" ] || { echo "FATAL: 自检 app 缺件 $SELFCHECK_APP/$f" >&2; exit 1; }
  done
fi

echo "==> [2/4] 毁灭性重建 $RES_DIR"
rm -rf "$RES_DIR"
mkdir -p "$RES_DIR"

echo "==> [3/4] 组装"
if [ "$MODE" = "genoffice" ]; then
  # app/:shim 源(scripts/shim/ 为准)+ shell out 全量(main bundle+chunks 菜单 PNG+preload×3+renderer Home)
  mkdir -p "$RES_DIR/app"
  # package.json 不带 "type":"module":out/main/index.js 是 electron-vite 产的 CJS bundle,
  # type:module 会令其在 ESM 语境解析 → "exports is not defined"(2026-09-20 首亮实锤);
  # main-shim.mjs 靠 .mjs 后缀天然 ESM,不受包级 type 影响。
  node -e '
    const v = require(process.argv[1] + "/apps/shell/package.json").version;
    require("fs").writeFileSync(process.argv[2], JSON.stringify({
      name: "genoffice", version: v, description: "GenOffice on HarmonyOS(Electron 37 fork)",
      main: "./main-shim.mjs",
    }, null, 2) + "\n");
  ' "$SRC" "$RES_DIR/app/package.json"
  cp -f scripts/shim/main-shim.mjs "$RES_DIR/app/main-shim.mjs"
  cp -a "$SRC/apps/shell/out" "$RES_DIR/app/out"
  # modules/:只取 preload+renderer(裁掉 out/main 死重 28.6M——standalone bundle,shell 模式不用)
  for m in $MODULES; do
    mkdir -p "$RES_DIR/modules/$m"
    cp -a "$SRC/apps/$m/out/preload" "$RES_DIR/modules/$m/preload"
    cp -a "$SRC/apps/$m/out/renderer" "$RES_DIR/modules/$m/renderer"
  done
  # wasm
  mkdir -p "$RES_DIR/wasm"
  cp -f "$SRC/node_modules/@embedpdf/pdfium/dist/pdfium.wasm" "$RES_DIR/wasm/"
  # 源名 harfbuzz-subset.wasm → 目标 hb-subset.wasm(wasm-path.ts:37 packaged 契约名)
  cp -f "$HB" "$RES_DIR/wasm/hb-subset.wasm"
  # notices(packaged 分支 index.ts:4622 读;缺失则跳过——About 对话框内容,不阻塞)
  NOTICES=$(ls "$SRC"/apps/shell/build/THIRD-PARTY-NOTICES.txt 2>/dev/null || true)
  [ -n "$NOTICES" ] && cp -f "$NOTICES" "$RES_DIR/" || echo "    提示: 无 THIRD-PARTY-NOTICES.txt(跑 npm run notices 生成;About 页缺失,不阻塞)"
else
  cp -a "$SELFCHECK_APP/." "$RES_DIR/app/"
  mkdir -p "$RES_DIR/app/wasm" "$RES_DIR/wasm"
  cp -f "$SRC/node_modules/@embedpdf/pdfium/dist/pdfium.wasm" "$RES_DIR/app/wasm/"
  cp -f entry/src/main/resources/base/media/app_icon.png "$RES_DIR/app/icon.png"
fi

# 公共清理:map 文件(--keep-maps 保留)、符号链接(HAP zip 安全)、.ts 残留
if [ "$KEEP_MAPS" = "0" ]; then find "$RES_DIR" -name "*.map" -type f -delete; fi
SYMLINKS=$(find "$RES_DIR" -type l | head -3)
[ -z "$SYMLINKS" ] || { echo "FATAL: 发现符号链接(HAP zip 不安全):$SYMLINKS" >&2; exit 1; }
TSFILES=$(find "$RES_DIR" -name "*.ts" -type f | head -3)
[ -z "$TSFILES" ] || { echo "FATAL: 发现 .ts 文件:$TSFILES" >&2; exit 1; }
NMDIRS=$(find "$RES_DIR" -type d -name node_modules | head -3)
[ -z "$NMDIRS" ] || { echo "FATAL: 发现 node_modules:$NMDIRS" >&2; exit 1; }

echo "==> [4/4] 断言"
if [ "$MODE" = "genoffice" ]; then
  grep -q '"main": "./main-shim.mjs"' "$RES_DIR/app/package.json"
  SZ=$(stat -c%s "$RES_DIR/app/out/main/index.js")
  [ "$SZ" -gt 5000000 ] || { echo "FATAL: main bundle 仅 $SZ bytes(<5M,构建异常)" >&2; exit 1; }
  for f in out/preload/index.js out/preload/update.js out/preload/pdf-password.js out/renderer/index.html; do
    [ -s "$RES_DIR/app/$f" ] || { echo "FATAL: 缺 app/$f" >&2; exit 1; }
  done
  PNGS=$(ls "$RES_DIR/app/out/main/chunks/"menu-*.png 2>/dev/null | wc -l)
  [ "$PNGS" -ge 10 ] || { echo "FATAL: 菜单 PNG 仅 $PNGS(<10,?asset 产物缺失)" >&2; exit 1; }
  for m in $MODULES; do
    [ -s "$RES_DIR/modules/$m/preload/index.js" ] || { echo "FATAL: 缺 modules/$m/preload/index.js" >&2; exit 1; }
    [ -s "$RES_DIR/modules/$m/renderer/index.html" ] || { echo "FATAL: 缺 modules/$m/renderer/index.html" >&2; exit 1; }
    [ ! -d "$RES_DIR/modules/$m/main" ] || { echo "FATAL: modules/$m/main 死重未裁" >&2; exit 1; }
  done
  for w in pdfium.wasm hb-subset.wasm; do
    [ "$(head -c4 "$RES_DIR/wasm/$w" | od -An -tx1 | tr -d ' \n')" = "0061736d" ] || { echo "FATAL: wasm/$w 非 wasm 魔数" >&2; exit 1; }
  done
  [ "$(stat -c%s "$RES_DIR/wasm/pdfium.wasm")" -gt 4000000 ] || { echo "FATAL: pdfium.wasm 过小" >&2; exit 1; }
else
  [ "$(stat -c%s "$RES_DIR/app/wasm/pdfium.wasm")" -gt 1000000 ] || { echo "FATAL: 自检 wasm 异常" >&2; exit 1; }
fi

du -sh "$RES_DIR"/* 2>/dev/null | sed 's/^/    /'
TOTAL=$(du -sm "$RES_DIR" | cut -f1)
echo "    合计 ${TOTAL}M"
if [ "$MODE" = "genoffice" ]; then
  { [ "$TOTAL" -ge 60 ] && [ "$TOTAL" -le 150 ]; } || echo "警告: 体积 ${TOTAL}M 超出预期区间 60~150M(基线 ≈110M,核对裁剪)" >&2
fi
echo "==> 组装完成(mode=$MODE)"
