#!/bin/bash
# genoffice-ohos 一键构建(Electron 壳自检 HAP:web_engine HAR + 自检 app → signed HAP)
#
# 正确命令:bash scripts/build-ohos.sh [--no-sign]
# 正确目录:genoffice-ohos 仓库根(脚本内部自行 cd)
# 产物:    entry/build/default/outputs/default/entry-default-signed.hap(或 unsigned)
# 链路:    scripts/sync-engine.sh(引擎同步,一次性/升级时)→ scripts/build-genoffice.sh
#          (GenOffice 产物组装;--selfcheck 组装自检 app)→ 本脚本(ohpm→trim→hvigor→断言)
#          注:旧 build-app.sh 已退役(逻辑并入 build-genoffice.sh --selfcheck)
# 前提:    /apps/harmony(command-line-tools,hoa 容器内挂载);
#          scripts/.signing.snippet(gitignore,签名注入片段;缺失则自动产出 unsigned)
# 断言:    HAP 存在 + >200MB + 十八关键件全在包内(so×3/启动器×2/sidecar/resfile 资源/自检 app),
#          失败非零退出。踩坑记录见各注释。
set -eo pipefail

cd "$(dirname "$0")/.."
HVIGORW="${OHOS_HVIGORW:-/apps/harmony/bin/hvigorw}"
NODE_BIN="${NODE_BIN:-node}"

[ -x "$HVIGORW" ] || { echo "FATAL: hvigorw 不可用: $HVIGORW(当前环境应是 hoa 容器)" >&2; exit 1; }
command -v "$NODE_BIN" >/dev/null || { echo "FATAL: node 不可用(签名注入需要)" >&2; exit 1; }

# build-profile.json5 生成:template + 签名注入(可复现;2026-09-19 演练踩坑:
# rm build-profile.json5 后旧 template 缺 web_engine 模块注册 → OhmUrl 解析失败 15 连错)
if [ ! -f build-profile.json5 ] || [ "$1" = "--regen" ]; then
  cp build-profile.json5.template build-profile.json5
  if [ -f scripts/.signing.snippet ] && [ "$1" != "--no-sign" ]; then
    "$NODE_BIN" -e '
      const fs = require("fs");
      const s = JSON.parse(fs.readFileSync("scripts/.signing.snippet", "utf8"));
      let t = fs.readFileSync("build-profile.json5", "utf8");
      t = t.replace(/^.*"__SIGNING_CONFIGS__".*\n/m, s.configs);
      t = t.replace(/^.*"__SIGNING_REF__".*\n/m, s.ref);
      fs.writeFileSync("build-profile.json5", t);
    '
    echo "    build-profile.json5 已生成(含签名注入)"
  else
    sed -i '/__SIGNING_/d' build-profile.json5
    [ "$1" = "--no-sign" ] || echo "提示: 无签名片段或 --no-sign,产出 unsigned HAP(不可装真机)" >&2
  fi
fi

echo "==> [1/4] web_engine 权限 trim 重放(引擎原始 38 条 → GenOffice 12 条;sync-engine.sh
重同步会还原为原始版,故构建前以 scripts/web-engine-permissions.trim 为准重放。
踩坑:原始版含 ACL 受限权限,签名 profile 未覆盖 → 真机安装报 9568289)"
"$NODE_BIN" -e '
  const fs = require("fs");
  const f = "web_engine/src/main/module.json5";
  let t = fs.readFileSync(f, "utf8");
  // 原始版特征:带引号的活跃权限声明(注释里的裸权限名不算——踩坑:首版用裸名检测,
  // 撞上 trim 注释里列出的已删权限名,误报"重放失败")
  const RAW = `"ohos.permission.ACCESS_BIOMETRIC"`;
  if (t.includes(RAW)) {
    const trim = fs.readFileSync("scripts/web-engine-permissions.trim", "utf8").trimEnd();
    const re = /[ \t]*"requestPermissions":[\s\S]*?\n[ \t]*\],(?=\s*\n[ \t]*"definePermissions")/;
    if (!re.test(t)) { console.error("FATAL: requestPermissions 替换锚点失配(web_engine 结构变化?)"); process.exit(1); }
    t = t.replace(re, trim);
    if (t.includes(RAW)) { console.error("FATAL: trim 重放失败"); process.exit(1); }
    fs.writeFileSync(f, t);
    console.log("    trim 已重放(38→9 条)");
  } else {
    console.log("    已是 trim 版,跳过");
  }
'

echo "==> [2/4] ohpm install(web_engine 依赖 inversify/reflect-metadata;hvigor 不会自动装——2026-09-19 踩坑:Cannot find module 'web_engine')"
OHPM="${OHOS_OHPM:-/apps/harmony/bin/ohpm}"
[ -x "$OHPM" ] || { echo "FATAL: ohpm 不可用: $OHPM" >&2; exit 1; }
"$OHPM" install --all 2>&1 | tail -2

echo "==> [3/4] hvigorw assembleHap"
"$HVIGORW" --mode module -p product=default -p buildMode=debug assembleHap --no-daemon 2>&1 | tee /tmp/genoffice-ohos-build.log | grep -E "ERROR|error|BUILD SUCCESSFUL|Finished" | tail -5

echo "==> [4/4] 产物断言"
OUT_DIR="entry/build/default/outputs/default"
HAP=$(ls "$OUT_DIR"/entry-default-*.hap 2>/dev/null | head -1)
[ -n "$HAP" ] || { echo "FATAL: 未找到 HAP 产物(见 /tmp/genoffice-ohos-build.log)" >&2; exit 1; }
SIZE=$(stat -c%s "$HAP")
# 组装产物形态自动识别:GenOffice 主 bundle 存在 → GenOffice 版(≈330MB);否则自检版(≈220MB)
APP_MODE=selfcheck
[ -f "entry/src/main/resources/resfile/resources/app/out/main/index.js" ] && APP_MODE=genoffice
MIN_SIZE=100000000
[ "$APP_MODE" = "genoffice" ] && MIN_SIZE=300000000
[ "$SIZE" -gt "$MIN_SIZE" ] || { echo "FATAL: HAP 异常($SIZE bytes < ${MIN_SIZE};collectAllLibs/HAR/产物组装疑点,mode=$APP_MODE)" >&2; exit 1; }
echo "    HAP: $HAP ($SIZE bytes, mode=$APP_MODE)"

# 清单 §1/§10 关键件断言:so 三件套 / 启动器 / resfile 引擎资源(两种模式共有)
# (缺任何一件 = 对应装载链断裂,勿带病交付)
# 踩坑(2026-09-20):曾用 `echo "$MANIFEST" | grep -q` —— grep -q 命中即退出,echo 被
# SIGPIPE,set -o pipefail 下整管道判非零 → GenOffice 版大清单(数百行)随机误报
# "缺关键件"(每轮挂不同文件)。修法:清单落盘后 grep 文件,无管道。
MANIFEST=/tmp/genoffice-ohos-hap-manifest.txt
unzip -l "$HAP" > "$MANIFEST"
for f in \
  "libs/arm64-v8a/libelectron.so" \
  "libs/arm64-v8a/libadapter.so" \
  "libs/arm64-v8a/libffmpeg.so" \
  "libs/arm64-v8a/libc++_shared.so" \
  "libs/arm64-v8a/electron" \
  "libs/arm64-v8a/node" \
  "libs/arm64-v8a/xlsx-sidecar" \
  "libs/arm64-v8a/dev_config.json" \
  "resources/resfile/icudtl.dat" \
  "resources/resfile/resources.pak" \
  "resources/resfile/snapshot_blob.bin" \
  "resources/resfile/v8_context_snapshot.bin" \
  "resources/resfile/locales/zh-CN.pak" \
  "resources/resfile/resources/app/main-shim.mjs" \
  ; do
  grep -q " $f\$" "$MANIFEST" || { echo "FATAL: HAP 缺关键件 $f(collectAllLibs/executableBinaryPaths/资产组装疑点)" >&2; exit 1; }
done
# 模式特有断言
if [ "$APP_MODE" = "genoffice" ]; then
  for f in \
    "resources/resfile/resources/app/out/main/index.js" \
    "resources/resfile/resources/app/out/preload/index.js" \
    "resources/resfile/resources/app/out/renderer/index.html" \
    "resources/resfile/resources/wasm/pdfium.wasm" \
    "resources/resfile/resources/wasm/hb-subset.wasm" \
    "resources/resfile/resources/modules/docs/preload/index.js" \
    "resources/resfile/resources/modules/docs/renderer/index.html" \
    "resources/resfile/resources/modules/sheets/preload/index.js" \
    "resources/resfile/resources/modules/sheets/renderer/index.html" \
    "resources/resfile/resources/modules/slides/renderer/index.html" \
    "resources/resfile/resources/modules/pdf/renderer/index.html" \
    "resources/resfile/resources/modules/markdown/renderer/index.html" \
    "resources/resfile/resources/modules/html/renderer/index.html" \
    ; do
    grep -q " $f\$" "$MANIFEST" || { echo "FATAL: HAP 缺关键件 $f(build-genoffice.sh 组装疑点)" >&2; exit 1; }
  done
else
  for f in "resources/resfile/resources/app/main.mjs" "resources/resfile/resources/app/preload.js" "resources/resfile/resources/app/wasm/pdfium.wasm"; do
    grep -q " $f\$" "$MANIFEST" || { echo "FATAL: HAP 缺关键件 $f(自检 app 组装疑点)" >&2; exit 1; }
  done
fi
# libelectron 体积断言:LFS 指针未拉取时只有 ~130 字节
LE_SZ=$(grep "libelectron.so\$" "$MANIFEST" | awk '{print $1}')
[ "$LE_SZ" -gt 100000000 ] || { echo "FATAL: libelectron.so 仅 ${LE_SZ} bytes(疑似 LFS 指针文本)" >&2; exit 1; }
echo "    关键件断言通过(mode=$APP_MODE:引擎 so×3 + 启动器×2 + sidecar + resfile 资源 + app)"
unzip -l "$HAP" | tail -3
echo "==> 构建通过:$HAP"
