#!/bin/bash
# verify-file-assoc.sh —— B4 文件关联抽验(六类 + 未知类型回落)
#
# 正确命令:bash scripts/verify-file-assoc.sh <device>
# 正确目录:仓库根(脚本内部自行定位)
# 前提:    ① 桌面上已备好测试文件 probe.{docx,xlsx,pptx,pdf,md,html,txt}
#          ② CDP 端口转发在位:`hdc -t <device> fport tcp:9333 tcp:9333`
# 判据:    每次 `aa start -U <file uri>` 后,CDP target 标题出现对应文件名;
#          应用为单实例(launchType=singleton),热启动应在**现有窗口**打开而非新开窗口
#
# 背景:文件关联需要公共目录里的真实文件,而 hdc 侧一律写不进去(2026-09-24 实测):
#      `ls /storage/Users` 在 shell 命名空间报 No such file or directory,
#      `hdc file send` 到同路径报 "Error opening file"。所以这批文件只能在
#      **设备上由应用自己准备**:新建文档后"另存为"到桌面,或从设备其他位置拷进来。
set -eo pipefail

DEV="${1:?用法: bash scripts/verify-file-assoc.sh <device>}"
BUNDLE="app.fuqidian.sotaoffice"
CDP="http://127.0.0.1:9333/json/list"
BASE="file://docs/storage/Users/currentUser/Desktop"
EXTS="docx xlsx pptx pdf md html"

echo "=== B4 文件关联抽验(设备 $DEV)==="
hdc list targets 2>/dev/null | grep -q "$DEV" || { echo "FATAL: 设备 $DEV 不在线"; exit 1; }
curl -s --max-time 5 "$CDP" >/dev/null || { echo "FATAL: CDP 不可达(检查 fport 转发与应用是否已启动)"; exit 1; }

titles() {
  curl -s --max-time 5 "$CDP" |
    grep -o '"title": "[^"]*"' |
    sed 's/"title": //' | tr -d '"' | tr '\n' '|'
}

echo "起始 targets: $(titles)"
for ext in $EXTS; do
  printf -- '--- probe.%s: ' "$ext"
  hdc -t "$DEV" shell "aa start -a EntryAbility -b $BUNDLE -U $BASE/probe.$ext" 2>&1 | head -1 | tr -d '\n'
  sleep 4
  printf ' → targets: %s\n' "$(titles)"
done

printf -- '--- 未知类型 probe.txt(应回落 Home 且不崩): '
hdc -t "$DEV" shell "aa start -a EntryAbility -b $BUNDLE -U $BASE/probe.txt" 2>&1 | head -1 | tr -d '\n'
sleep 4
printf ' → targets: %s\n' "$(titles)"

echo "=== 完成:逐项核对上方 targets 是否出现对应文件名;"
echo "    另需查看各 target 的实际渲染(CDP Page.captureScreenshot 或真机目视)==="
