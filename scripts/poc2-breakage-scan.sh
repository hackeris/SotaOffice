#!/bin/bash
# POC-2:GenOffice 在 electron@37(= 鸿蒙 fork 运行时版本)下的兼容性清点
#
# 用法:  bash scripts/poc2-breakage-scan.sh [--with-smoke]
# 前提:  $WORK_DIR(../genoffice-e37)已完成 npm install 且 electron 锁定 37.2.0
# 产物:  docs/poc2-breakage-report.md(断点清单)
#        /tmp/poc2-*.log(各阶段完整日志)
# 阶段:  1) 逐包 typecheck(electron@37 类型定义 vs 43 代码)
#        2) 逐包 build(main/preload/renderer 构建)
#        3) [--with-smoke] xvfb 无头冒烟(shell 启动)
# 注意:  本脚本**收集失败而非中断**——清点的目的就是穷尽断点;
#        退出码:0=跑完(无论发现多少断点),1=环境性失败(install 缺失等)
set -uo pipefail   # 故意不用 -e:逐包收集

OHOS_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WORK_DIR="${WORK_DIR:-$(dirname "$OHOS_DIR")/genoffice-e37}"
REPORT="$OHOS_DIR/docs/poc2-breakage-report.md"
mkdir -p "$OHOS_DIR/docs"

fail() { echo "FATAL: $*" >&2; exit 1; }

[ -d "$WORK_DIR/node_modules" ] || fail "$WORK_DIR 未安装依赖(先跑 npm install)"
grep -q '"electron": "37' "$WORK_DIR/apps/shell/package.json" || fail "$WORK_DIR electron 版本未锁 37(先跑环境脚本)"
ELECTRON_VER="$(cd "$WORK_DIR/apps/shell" && node -e 'console.log(require("electron/package.json").version)' 2>/dev/null)" \
  || fail "无法读取 electron 版本(apps/shell/node_modules/electron 缺失)"
echo "== POC-2 breakage scan: workdir=$WORK_DIR electron=$ELECTRON_VER =="

# 从根 package.json 的 typecheck 脚本提取包清单(单一数据源,避免漂移)
PKGS="$(node -e '
  const s = require(process.argv[1] + "/package.json").scripts.typecheck;
  const out = [];
  for (const m of s.matchAll(/-w (@genoffice\/[a-z0-9-]+)/g)) out.push(m[1]);
  console.log(out.join(" "));
' "$WORK_DIR")"
[ -n "$PKGS" ] || fail "无法从根 package.json 提取包清单"

: > "$REPORT"
echo "# POC-2:GenOffice × electron@${ELECTRON_VER} 兼容性断点清单" >> "$REPORT"
echo "" >> "$REPORT"
echo "> 生成:$(date '+%F %T') | 工作区:$WORK_DIR | 原版本:43.3.0" >> "$REPORT"
echo "> 方法:typecheck(electron@37 .d.ts)/ build(electron-vite)/ 冒烟(xvfb)" >> "$REPORT"
echo "" >> "$REPORT"

run_stage() {  # run_stage <阶段名> <命令...>(在 $WORK_DIR 下执行)
  local stage="$1"; shift
  echo "---------------- [$stage] ----------------"
  local log="/tmp/poc2-${stage}.log"
  if (cd "$WORK_DIR" && "$@" >"$log" 2>&1); then
    echo "PASS $stage"
    echo "## $stage ✅ 通过" >> "$REPORT"
    return 0
  else
    echo "FAIL $stage (see $log)"
    echo "## $stage ❌" >> "$REPORT"
    echo '```' >> "$REPORT"
    grep -E 'error TS|Error|error' "$log" | sort -u | head -40 >> "$REPORT"
    echo '```' >> "$REPORT"
    return 1
  fi
}

# ---- 阶段 1:typecheck 逐包 ----
echo "## 1. typecheck(electron@37 类型层)" >> "$REPORT"
TC_FAIL=0; TC_TOTAL=0
for pkg in $PKGS; do
  TC_TOTAL=$((TC_TOTAL+1))
  run_stage "typecheck-$(basename "$pkg")" npm run typecheck -w "$pkg" --if-present || TC_FAIL=$((TC_FAIL+1))
done
echo "" >> "$REPORT"
echo "**typecheck 小计:$((TC_TOTAL-TC_FAIL))/$TC_TOTAL 通过**" >> "$REPORT"

# ---- 阶段 2:build 逐包(shell 最后,它聚合六模块 main)----
echo "## 2. build(构建层)" >> "$REPORT"
B_FAIL=0; B_TOTAL=0
for pkg in $PKGS; do
  B_TOTAL=$((B_TOTAL+1))
  run_stage "build-$(basename "$pkg")" npm run build -w "$pkg" --if-present || B_FAIL=$((B_FAIL+1))
done
echo "" >> "$REPORT"
echo "**build 小计:$((B_TOTAL-B_FAIL))/$B_TOTAL 通过**" >> "$REPORT"

# ---- 阶段 3:冒烟(可选)----
if [ "${1:-}" = "--with-smoke" ]; then
  echo "## 3. smoke(xvfb 无头启动)" >> "$REPORT"
  command -v xvfb-run >/dev/null || fail "xvfb-run 不可用"
  ( cd "$WORK_DIR/apps/shell" && timeout 60 xvfb-run -a npx electron . >/tmp/poc2-smoke.log 2>&1 )
  rc=$?
  echo "smoke rc=$rc(124=超时存活,视为启动成功;非 0 且非 124=崩溃)" >> "$REPORT"
  tail -50 /tmp/poc2-smoke.log >> "$REPORT"
fi

echo "" >> "$REPORT"
echo "---" >> "$REPORT"
echo "完整日志:/tmp/poc2-*.log" >> "$REPORT"

echo "== done: report at $REPORT =="
