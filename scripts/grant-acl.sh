#!/bin/bash
# grant-acl.sh —— 装机后 ACL 三连授权(文档/下载/桌面)+ 生效核验
#
# 正确命令: bash scripts/grant-acl.sh [device]
# 正确目录: 仓库根(脚本内部自行定位)
# 前提:     应用已安装;源码侧三条 user_grant ACL 见
#           entry/src/main/ets/entryability/EntryAbility.ets:214-220
# 判据:     点击循环结束后重启应用,shim 日志三条均报
#           "系统目录可写"(出现 "降级 → el2" 即该条未生效)
#
# 背景(2026-09-24 实测,勿按旧经验误判):
#   * 三条 ACL 是 user_grant:声明+profile 只给"申请资格",装机后首次启动会弹
#     系统模态授权框(1/3 文档 → 2/3 下载 → 3/3 桌面)。**超时或拒绝后应用会
#     走到 window-all-closed 静默退出**(退出码 0、无 uncaughtException、无
#     renderer 进程)——现象酷似崩溃,实为未授权硬门槛。
#   * 卸载重装会清空已授予的授权,故每次重装后都要跑本脚本。
#   * 系统授权框是 ArkUI 弹窗,在无障碍树中可见可点;而 Electron 应用窗口的
#     系统标题栏三键**不在**树里(应用 DOM 在树里)。因此授权框用坐标点其
#     "允许"按钮中心即可,但**不要**按坐标硬点应用标题栏三键——实测会把
#     "全部标签"按钮点开。
set -eo pipefail

DEV="${1:?用法: bash scripts/grant-acl.sh <device>}"
BUNDLE="app.fuqidian.sotaoffice"
TMPD=/data/local/tmp
MAXCLICK="${MAXCLICK:-6}"
SHIM_LOG="/data/app/el2/100/base/$BUNDLE/files/shim-log.txt"

echo "=== ACL 授权(设备 $DEV)==="
hdc list targets 2>/dev/null | grep -q "$DEV" || { echo "FATAL: 设备 $DEV 不在线" >&2; exit 1; }

# 注:hdc shell 不传递远端退出码,故用输出计数判断,不能用 if hdc shell ... grep -q
NPROC=$(hdc -t "$DEV" shell "ps -ef | grep [s]otaoffice | wc -l" | tr -d '\r ')
if [ "${NPROC:-0}" -eq 0 ]; then
  echo "应用未运行,拉起(等 15s 到弹框)…"
  hdc -t "$DEV" shell "aa start -a EntryAbility -b $BUNDLE" >/dev/null
  sleep 15
fi

clicked=0
for _ in $(seq 1 "$MAXCLICK"); do
  hdc -t "$DEV" shell "uitest dumpLayout -p $TMPD/acl.json" >/dev/null 2>&1 || true
  hdc -t "$DEV" file recv "$TMPD/acl.json" /tmp/acl-layout.json >/dev/null 2>&1 || true
  POS=$(python3 - /tmp/acl-layout.json <<'PY'
import json, re, sys
try:
    node = json.load(open(sys.argv[1]))
except Exception:
    sys.exit(0)
hit = []
def walk(n):
    a = n.get('attributes', {})
    if (a.get('text') or '').strip() == '允许' and a.get('bounds'):
        m = re.findall(r'-?\d+', a['bounds'])
        if len(m) == 4:
            hit.append(((int(m[0]) + int(m[2])) // 2, (int(m[1]) + int(m[3])) // 2))
    for c in n.get('children', []):
        walk(c)
walk(node)
if hit:
    print(*hit[-1])
PY
)
  [ -n "$POS" ] || { echo "无授权框(已授权或未弹出),跳过"; break; }
  echo "点击 '允许' @ $POS"
  hdc -t "$DEV" shell "uitest uiInput click $POS" >/dev/null 2>&1 || true
  clicked=$((clicked + 1))
  sleep 2
done
echo "本轮点击 $clicked 次"

echo "==> 重启应用以让权限在进程级生效"
hdc -t "$DEV" shell "aa force-stop $BUNDLE" >/dev/null
sleep 3
hdc -t "$DEV" shell "aa start -a EntryAbility -b $BUNDLE" >/dev/null
sleep 18

echo "==> 核验:三目录落点"
hdc -t "$DEV" shell "tail -40 $SHIM_LOG" | grep -E "documents:|downloads:|desktop:" || true
echo "    期望:最新一次启动的三条均 '系统目录可写'"
echo "    注:上文若同时出现 '降级 → el2' 与 '系统目录可写',降级属**授权前**那一轮启动,以时间戳最新的一段为准"
echo "    (勿用 hdc ls 核验桌面:shell 对 /storage/Users 是命名空间隔离,一律看不到)"
echo "    若最新一段仍 '降级 → el2',说明该条授权未生效——重跑本脚本并核对弹框序号(1/3~3/3)"
