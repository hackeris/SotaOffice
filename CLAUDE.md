# Smart Office 鸿蒙移植

把 Smart Office（一款 Electron 桌面办公套件）搬到 HarmonyOS 上的工程仓。

## 做法

应用本身不重写，只把运行时换掉：用 openharmony-sig 维护的 Electron 37 fork 替代官方 Electron，
原应用的构建产物原样装进 HAP。这条路能成立，靠的是三个前提——应用零 napi 模块、renderer 是纯 Web、
原生依赖只有一支 Rust 写的 xlsx sidecar（交叉编译后经 `executableBinaryPaths` 拉起）。

## 四条纪律

1. **工程位置** —— 正式内容平铺在仓根（`AppScope/` `entry/` `web_engine/` `scripts/` `docs/` `thirdparty/`）。
   `.temp/` 只放临时研究素材，永不入库。
2. **依赖治理** —— 第三方依赖一律以 submodule 引入 `thirdparty/`，钉 release tag 或 commit，
   不引用 `.temp/` 里的素材。版本锚定见 `thirdparty/VERSIONS.md`。
3. **构建可复现** —— 一条链（两步以上，或含外部命令）交付时，必须同时有「一键脚本」和
   「毁灭性重建演练通过」。步骤不能只活在会话记忆里。
4. **不写参考项目名**，注释不记流水账。

## 构建、装机、验证

```sh
npm run build:ohos                    # sync-engine → build-genoffice --no-build → build-ohos
bash scripts/grant-acl.sh <device>    # 装机后必跑。不跑，应用会静默退出
bash scripts/rebuild-drill.sh      # 毁灭性重建演练，全绿才算可复现
node scripts/e2e/ohos-smoke.mjs       # 真机 smoke（需先 hdc fport 映射 9333）
```

**装机后的硬门槛**：那三条目录权限（文档／下载／桌面）是 user_grant，没授权时渲染进程不会创建，
应用直接走 `window-all-closed` 退出——**退出码 0、没有异常、ps 里连 renderer 都没有**，看着像崩溃，
其实只是没授权。卸载重装会清空授权，每次重装都得重跑 `grant-acl.sh`。

## 动这些地方之前，先查文档

| 要改的东西 | 先看哪里 |
| --- | --- |
| `web_engine/` 的适配层、`module.json5` | `docs/ELECTRON_OHOS_CHECKLIST.md` §2 —— 白屏有三个易漏点；权限的唯一事实源也在这里 |
| `scripts/shim/main-shim.mjs` | 文件头注释 —— 桩的装载顺序是铁律，`process.resourcesPath` 不要轻易碰 |
| 构建脚本里的产物路径 | `scripts/sync-engine.sh` 头注释 —— 构建期布局和运行期路径不是同一套（`arm64-v8a` vs `arm64`） |
| 应用侧代码（`thirdparty/` 里的） | `docs/PORT_DESIGN.md` §5 —— 那是 submodule，只 cherry-pick 不 merge |

## 命名对照

产品正在做去上游化改造，代码里的旧标识会逐步替换，清单在 `docs/SOTA_RELEASE_TODO.md`。

| 出现的场合 | 名字 |
| --- | --- |
| 仓库名、`package.json` | `smartoffice-ohos` |
| 产品名、HAP 包名 | Smart Office / `app.fuqidian.sotaoffice`（bundleName 不随产品名变） |
| 上游应用名、代码里的标识符 | GenOffice |
| 早期脚本注释 | `genoffice-ohos` |

## 文档

全部文档的索引在 `docs/README.md`，按角色和主题两个方向导航。
