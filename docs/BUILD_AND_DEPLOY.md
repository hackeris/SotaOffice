# 构建与装机

从零把工程构建出来、装到真机上跑起来，以及中间容易卡住的地方。

命令都从仓根执行。

## 全貌

```
sync-engine.sh        组装引擎二进制与资源
      ↓
build-genoffice.sh    组装应用产物到 resfile
      ↓
build-ohos.sh         权限校验 → ohpm → hvigor → 打包 HAP
      ↓
装机 + 授权            bm install → grant-acl.sh（必做，漏了应用会静默退出）
      ↓
验证                  smoke / 文件关联 / CDP 探针
```

前三步封在 `npm run build:ohos` 里。

## 前置

- **OHOS SDK 与命令行工具**：`hvigorw`、`ohpm`、`hdc`、`node` 都要在 PATH 里。
  当前构建环境是容器，工具链由容器提供。
- **应用产物仓库**：`thirdparty/genoffice`（submodule）。它自己的构建产物是这一步的输入，
  首次要先进去 `npm ci` 加 `npm run build:all`。详见「第二步」。
- **Rust 交叉编译 target**：`aarch64-unknown-linux-ohos`，编译 xlsx sidecar 用。
- **submodule 初始化**：应用产物仓库带 Git LFS 文件，克隆时要跳过 smudge，
  否则拉下来的是指针（详见故障表第 12 条）。
- **一台 2in1 形态的真机**：应用声明了 `executableBinaryPaths`，**平板装不上**
  （报 `9568449`）。这是安装期校验，跟包本身没关系，详见故障表。

```sh
GIT_LFS_SKIP_SMUDGE=1 git submodule update --init
```

## 第一步：组装引擎

```sh
bash scripts/sync-engine.sh [引擎产物源目录]
```

把 Electron fork 的构建产物组装进工程：`web_engine/libs/arm64-v8a/` 下的几个 `.so`、
`web_engine/src/main/resources/resfile/` 下的引擎资源、以及 `entry/libs/arm64-v8a/`
里的启动器（`electron`、`node`、`libc++_shared.so`、`dev_config.json`）。

引擎版本升级后要重跑这一步，再走后面两步。

两条容易踩的：

- **`dev_config.json` 必须落在 entry 的 libs 下**。`libadapter.so` 里硬编码读取这个位置，
  放 resfile 里不生效——远程调试端口 9333 就是从这儿开的。
- **只组装二进制，不碰源码**。`web_engine` 的 ets 适配层和 `module.json5` 已经纳入本仓 git 管理，
  这个脚本不会覆盖它们。

## 第二步：组装应用产物

```sh
bash scripts/build-genoffice.sh [--no-build] [--selfcheck] [--src <目录>]
```

把应用仓库的产物组装进 `entry/src/main/resources/resfile/resources/`：

| 产物 | 内容 |
| --- | --- |
| `app/` | 主进程 bundle、`main-shim.mjs`、`package.json`（`main` 指向 shim） |
| `modules/<模块>/` | 六个模块各自的 preload 与 renderer |
| `wasm/` | `pdfium.wasm`、`hb-subset.wasm` |
| `THIRD-PARTY-NOTICES.txt` | 关于对话框里的第三方声明 |

顺带会交叉编译 xlsx sidecar 并落到 entry 的 libs 下。

**这个脚本不编译应用本身**，只做组装。应用产物得先在 `thirdparty/genoffice` 里构建：

```sh
cd thirdparty/genoffice
npm ci --ignore-scripts --registry=https://registry.npmmirror.com
# electron 的 postinstall 直连 GitHub 会超时，要手动跑并指定镜像
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ node node_modules/electron/install.js
npm run build:all
```

`cargo` 要在 PATH 里（sheets 的原生构建需要）。不加 `--no-build` 时脚本会自动跑 `build:all`，
耗时几分钟，日常组装用 `--no-build` 跳过。

组装完会断言体积在 60～150MB 之间，基线约 110MB。超范围说明有东西多装或漏装。

**分支守卫**：应用仓库必须在允许的分支上，脚本里是精确匹配（不是前缀），
新增工作分支时要一并加进去。

## 第三步：打包 HAP

```sh
bash scripts/build-ohos.sh [--no-sign]
```

流程是：校验权限声明 → `ohpm install` → `hvigorw assembleHap` → 31 项产物断言。

产物在 `entry/build/default/outputs/default/` 下，签名的叫 `entry-default-signed.hap`。

脚本会**自动识别组装形态**：看应用主 bundle 在不在，在就是 GenOffice 版、体积阈值 300MB；
不在就是自检版、阈值 100MB。两种模式的阈值不同，所以自检模式不会被误判成"构建失败"。

- **没有签名材料就产 unsigned HAP，装不上真机**。签名材料从 `scripts/.signing.snippet`
  注入，缺了会自动降级并提示。相关的材料清单见 `PERMISSIONS_ACL.md`。
- **`hvigor` 不会自动装依赖**，脚本里显式调了 `ohpm install`。手动跑 hvigor 时报
  `Cannot find module 'web_engine'` 就是这个原因。

## 装机与授权

```sh
hdc file send entry/build/default/outputs/default/entry-default-signed.hap /data/local/tmp/go.hap
hdc shell "bm install -p /data/local/tmp/go.hap && aa start -a EntryAbility -b app.fuqidian.sotaoffice"

# 必做：三条目录权限是 user_grant，不授权应用会静默退出
bash scripts/grant-acl.sh <device>
```

装的时候报 `9568332`，先 `bm uninstall` 再装。

**装机后的硬门槛**：文档／下载／桌面这三条权限是 user_grant，首次启动会依次弹三个系统授权框。
没授权（超时或拒绝）时渲染进程根本不会创建，应用直接走 `window-all-closed` 退出——
**退出码 0、没有异常、`ps` 里连 renderer 都没有**，看着像崩溃，其实只是没授权。

`grant-acl.sh` 会自动点三次"允许"、重启应用、再核验。**卸载重装会清空授权，每次重装后都要重跑**。

授权流程和判断依据见 `DEVICE_OPERATIONS.md`。

## 验证

```sh
hdc fport tcp:9333 tcp:9333                    # CDP 通道，验证手段都靠它

node scripts/e2e/ohos-smoke.mjs                # 七个用例：boot / home / markdown-edit /
                                               # docs-open / docs-export-pdf / sheets-sidecar / pdf-wasm
bash scripts/verify-file-assoc.sh <device>     # 文件关联，六类加一个未知类型
node scripts/selfcheck-cdp.mjs                 # 自检 HAP 的探针
```

## 证明可复现

```sh
bash scripts/m1-rebuild-drill.sh
```

删掉全部可重建产物，再从零跑一遍三个脚本，全绿才算数。

注意它**只删可重建的东西**。`web_engine` 的 ets 适配层和 `module.json5` 是自有化入库的源码，
删了 `sync-engine.sh` 不会给你恢复——脚本里点名了三个防线文件，误删要 `git checkout` 回来。

## 常见故障对照

| 现象 | 原因 | 怎么办 |
| --- | --- | --- |
| 应用启动后静默退出，退出码 0、无异常 | 三条目录权限没授权 | 跑 `grant-acl.sh`（第 1 条） |
| hvigor PreBuild 报 `00304069` | `entry/src/main/module.json5` 声明了 `executableBinaryPaths`，但 sidecar 文件不在位 | 跑 `build-genoffice.sh` 把 sidecar 编出来 |
| 应用界面全白 | 三个易漏点：`nativeLib.collectAllLibs` 没开、`CustomChildProcess.toString()` 被删、`runBrowser` 没在 XComponent 的 onLoad 里调 | 对照 `ELECTRON_OHOS_CHECKLIST.md` §2 |
| 装机报 `9568289` | 声明了受限权限，但签名 profile 没覆盖 | 见 `PERMISSIONS_ACL.md` |
| 装机报 `9568332` | 已有同名应用 | `bm uninstall` 后再装 |
| 装机报 `9568449`（`check bin file failed`） | **设备是平板**。应用声明了 `executableBinaryPaths`，而这类应用只有 PC/2in1 形态支持安装 | 换 2in1 设备。官方给的另一条路是把 `compressNativeLibs` 改成 `true`，但那与应用要求可执行文件直接 exec 的前提冲突，未验证 |
| 装上了但白屏 | `libelectron.so` 可能是 LFS 指针，只有约 130 字节 | 构建期有 `>100MB` 断言拦截；检查克隆时是否跳过了 smudge |
| 组装时随机报"缺关键件"，每轮挂的文件还不一样 | 管道里 `echo` 大清单配合 `grep -q` 触发 SIGPIPE | 清单落盘再 grep（脚本里已修） |
| 应用起不来，日志停在某个桩 | 主进程 bundle 被当成 ESM 解析了 | `app/package.json` 不能带 `type: module` |
| 修改 shim 后行为没变 | shim 的源在 `scripts/shim/`，要重新跑 `build-genoffice.sh` 才会拷进产物 | 构建产物和源码是两份 |

## 开关一览

| 脚本 | 开关 | 作用 |
| --- | --- | --- |
| `build-genoffice.sh` | `--no-build` | 跳过应用的 `build:all`，只组装 |
| | `--selfcheck` | 改组装自检 app，首亮失败时用来隔离"壳坏了"还是"产物问题" |
| | `--keep-maps` | 保留 `.map`（默认删） |
| | `--src <目录>` | 指定应用仓库位置 |
| `build-ohos.sh` | `--no-sign` | 产 unsigned HAP |
| | `--regen` | 强制重建 `build-profile.json5` |
| `poc2-breakage-scan.sh` | `--with-smoke` | 额外跑无头冒烟 |
| `shim` | `GO_SHIM_TRAY=1` | 兜底托盘 |

`e2e/ohos-smoke.mjs` 可以只跑单个用例，把 suite 名当参数传。
