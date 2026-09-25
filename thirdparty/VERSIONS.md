# thirdparty 版本锚定

第三方依赖一律以 submodule 引入，钉 release tag 或 commit，不引用 `.temp/` 里的临时素材。

## 当前钉住的版本

| 目录 | 依赖 | 当前 commit | 锚点 | remote(fork) |
| --- | --- | --- | --- | --- |
| `genoffice/` | 应用本体 | `a1acf05` | 工作分支 `ohos/sota-debrand`（**尚无 tag**） | `github.com/hackeris/genoffice` |
| `electron/` | Electron 本体（HarmonyOS fork） | `3af8ccb` | tag **`ohos-v37.2.0`** | `gitcode.com/openharmony-sig/electron`（官方仓） |

## 应用仓库的两个锚点

应用仓库上现在有两个位置的 commit，submodule 钉在较新的那个：

| commit | 所在分支 | tag | 内容 |
| --- | --- | --- | --- |
| `339470d` | `ohos/electron37` | **`ohos-v1.0.0`** | 上游 `316ded6` + electron 37.2.0 pin（9 文件，与 `scripts/patches/genoffice-e37-pin.patch` 同源） |
| `a1acf05` | `ohos/sota-debrand` | 无 | 在上一行基础上做去上游化改造（账号链移除、默认厂商切换等） |

electron 那边只有一个锚点：tag `ohos-v37.2.0` = 官方 fork 分支
`electron-v37.2.0-openharmony` 的 HEAD（Chromium 138 + Node 22）。

## 操作

```sh
# 首次克隆
GIT_LFS_SKIP_SMUDGE=1 git submodule update --init        # electron 源含 LFS,跳过

# 校验:submodule 钉的 commit 是否正好等于某个 tag
git -C thirdparty/electron describe --tags --exact-match     # 应输出 ohos-v37.2.0
git -C thirdparty/genoffice describe --tags --exact-match     # 当前会失败,见下

# fork 推送(在 submodule 里执行,tag 随分支一起推)
git push origin <分支> && git push origin <tag>
```

**应用仓库的校验命令当前会报 `no tag exactly matches`**——因为 submodule 已经推进到
`ohos/sota-debrand` 的 `a1acf05`，而这个位置还没有打 tag。这是预期状态，不是损坏；
等这轮改造收尾、在 fork 上打好新 tag 之后，再把它作为锚点更新到上表。

## 说明

- submodule 记录的是 commit。tag 是静态锚点，作用是让这个 commit 可追溯、可复现。
- `.gitmodules` 里的 `branch` 字段只供 `git submodule update --remote` 跟踪维护分支用，
  它跟 tag 锚定是两回事。
- `.temp/engine-ref/`（不入库）= 引擎集成方式的参考源,兼 `sync-engine.sh` 的默认取源地。
