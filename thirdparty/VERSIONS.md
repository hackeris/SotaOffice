# thirdparty 版本锚定

第三方依赖一律以 submodule 引入，钉 release tag 或 commit，不引用 `.temp/` 里的临时素材。

## 当前钉住的版本

| 目录 | 依赖 | 当前 commit | 锚点 | remote(fork) |
| --- | --- | --- | --- | --- |
| `genoffice/` | 应用本体 | `14a54c1e` | 工作分支 `ohos/sota-debrand`，基线锚点 tag **`ohos-v1.0.1`** | `github.com/hackeris/genoffice` |
| `electron/` | Electron 本体（HarmonyOS fork） | `3af8ccb` | tag **`ohos-v37.2.0`** | `gitcode.com/openharmony-sig/electron`（官方仓） |

## 应用仓库的两个锚点

应用仓库上现在有两个位置的 commit，submodule 钉在较新的那个：

| commit | 所在分支 | tag | 内容 |
| --- | --- | --- | --- |
| `339470d` | `ohos/electron37` | **`ohos-v1.0.0`** | 上游 `316ded6` + electron 37.2.0 pin（9 文件，与 `scripts/patches/genoffice-e37-pin.patch` 同源） |
| `be0834fd` | `ohos/sota-debrand` | **`ohos-v1.0.1`** | 上游 `4dc4b7b3`（v0.11.829 快照）+ electron 37.2.0 pin（9 文件，同上） |
| `6482d2b8` | `ohos/sota-debrand` | 无 | 在 `ohos-v1.0.1` 之上重放 26 个去上游化/品牌替换/鸿蒙适配补丁，再加对账修复提交 |

electron 那边只有一个锚点：tag `ohos-v37.2.0` = 官方 fork 分支
`electron-v37.2.0-openharmony` 的 HEAD（Chromium 138 + Node 22）。

## 操作

```sh
# 首次克隆
GIT_LFS_SKIP_SMUDGE=1 git submodule update --init        # electron 源含 LFS,跳过

# 只有要自编译引擎时才需要:把 LFS 对象拉全
# (patch 与 ohos_sdk 工具链默认落成 130 字节的指针,不拉全 electron_build.sh 用不了)
git -C thirdparty/electron lfs pull

# 校验:submodule 钉的 commit 是否正好等于某个 tag
git -C thirdparty/electron describe --tags --exact-match     # 应输出 ohos-v37.2.0
git -C thirdparty/genoffice describe --tags --exact-match     # 当前会失败,见下

# fork 推送(在 submodule 里执行,tag 随分支一起推)
git push origin <分支> && git push origin <tag>
```

**应用仓库的校验命令当前会报 `no tag exactly matches`**——submodule 钉在
`ohos/sota-debrand` 的 `6482d2b8`（tag `ohos-v1.0.1` 之后的补丁 tip），补丁没有
单独打 tag。这是预期状态，不是损坏；基线锚点用 `ohos-v1.0.1` 校验：

```sh
git -C thirdparty/genoffice merge-base --is-ancestor ohos-v1.0.1 HEAD && echo ok
```

## 说明

- submodule 记录的是 commit。tag 是静态锚点，作用是让这个 commit 可追溯、可复现。
- `.gitmodules` 里的 `branch` 字段只供 `git submodule update --remote` 跟踪维护分支用，
  它跟 tag 锚定是两回事。
- `.temp/engine-ref/`（不入库）= 引擎集成方式的参考源,兼 `sync-engine.sh` 的默认取源地。
