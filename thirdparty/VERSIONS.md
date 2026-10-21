# thirdparty 版本锚定

第三方依赖一律以 submodule 引入，钉 release tag 或 commit，不引用 `.temp/` 里的临时素材。

## 当前钉住的版本

| 目录 | 依赖 | 当前 commit | 锚点 | remote(fork) |
| --- | --- | --- | --- | --- |
| `genoffice/` | 应用本体 | `1c6b9ab5` | fork 默认分支 **`main`**（= 工作分支 `ohos/sota-debrand-v0.11.829`），发布 tag **`ohos-v1.0.4`**（基线锚点 `ohos-v1.0.1`） | `github.com/hackeris/genoffice` |
| `electron/` | Electron 本体（HarmonyOS fork） | `3af8ccb` | tag **`ohos-v37.2.0`** | `gitcode.com/openharmony-sig/electron`（官方仓） |
| `node-sqlite/` | node:sqlite 独立实现（NAPI addon 源，vendor 编译用） | `f529c62` | tag **`v3.3.0`** | `github.com/photostructure/node-sqlite`（上游，只读） |

## 应用仓库的锚点

应用仓库上有四个 tag 锚点，submodule 钉在最新的那个：

| commit | 所在分支 | tag | 内容 |
| --- | --- | --- | --- |
| `339470d` | `ohos/electron37` | **`ohos-v1.0.0`** | 上游 `316ded6` + electron 37.2.0 pin（9 文件，与 `scripts/patches/genoffice-e37-pin.patch` 同源） |
| `be0834fd` | `ohos/sota-debrand-v0.11.829` | **`ohos-v1.0.1`** | 上游 `4dc4b7b3`（v0.11.829 快照）+ electron 37.2.0 pin（9 文件，同上） |
| `14a54c1e` | `ohos/sota-debrand-v0.11.829` | 无 | 在 `ohos-v1.0.1` 之上重放 26 个去上游化/品牌替换/鸿蒙适配补丁，再加对账/pin 适配修复 |
| `1b7178f5` | `ohos/sota-debrand-v0.11.829` 与 **`main`** | **`ohos-v1.0.3`** | 1.0.3 发布内容：文件索引 sqlite 以自研纯 C 绑定复活（sota-sqlite，见 `apps/shell/vendor/sqlite/`） |
| `1c6b9ab5` | `ohos/sota-debrand-v0.11.829` 与 **`main`** | **`ohos-v1.0.4`** | sheets AI 面板默认收起对齐其余五应用（上游 `aiPanelInitiallyOpen` 默认展开） |

旧产品线（上游 `316ded6` 基线、26 个补丁重放前）保留在 `ohos/sota-debrand` 分支
（tip `edec2ef9`）。主仓 master 与 fork 默认分支 `main` 均已晋升新线——`main` 是
`ohos/sota-debrand-v0.11.829` 的快进别名，原本的上游 main 镜像被其覆盖（需要时
可从上游重新拉取）；`ohos/electron37`（上游基线锚 `ohos-v1.0.0`）保留不动。

electron 那边只有一个锚点：tag `ohos-v37.2.0` = 官方 fork 分支
`electron-v37.2.0-openharmony` 的 HEAD（Chromium 138 + Node 22）。

`node-sqlite`（photostructure）是 `node:sqlite` 的 API 兼容独立实现。鸿蒙 fork 未编入
内置 sqlite binding，且 C++ addon 在 OHOS 上不可活（`libace_napi.z.so` interpose 链接期
`napi_*`，见 `genoffice` 的 `apps/shell/vendor/sqlite/build.sh` 文件头）——文件索引的
`DatabaseSync` 由自研纯 C 绑定 `sota-sqlite` 提供（同 vendor 目录），本 submodule 只出
`sqlite3.c/.h` amalgamation 源与编译 flags 参考。只读依赖，不 fork。

## 操作

```sh
# 首次克隆
GIT_LFS_SKIP_SMUDGE=1 git submodule update --init        # electron 源含 LFS,跳过

# 只有要自编译引擎时才需要:把 LFS 对象拉全
# (patch 与 ohos_sdk 工具链默认落成 130 字节的指针,不拉全 electron_build.sh 用不了)
git -C thirdparty/electron lfs pull

# 校验:submodule 钉的 commit 是否正好等于某个 tag
git -C thirdparty/electron describe --tags --exact-match     # 应输出 ohos-v37.2.0
git -C thirdparty/genoffice describe --tags --exact-match     # 应输出 ohos-v1.0.4

# fork 推送(在 submodule 里执行,tag 随分支一起推)
git push origin <分支> && git push origin <tag>
```

## 说明

- submodule 记录的是 commit。tag 是静态锚点，作用是让这个 commit 可追溯、可复现。
- `.gitmodules` 里的 `branch` 字段只供 `git submodule update --remote` 跟踪维护分支用，
  它跟 tag 锚定是两回事。
- `.temp/engine-ref/`（不入库）= 引擎集成方式的参考源,兼 `sync-engine.sh` 的默认取源地。
