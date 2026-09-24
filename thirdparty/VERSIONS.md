# thirdparty 版本锚定

第三方依赖一律以 submodule 引入，钉 release tag 或 commit，不引用 `.temp/` 里的临时素材。

## 当前钉住的版本

| 目录 | 依赖 | 当前 commit | 锚点 | remote(fork) |
| --- | --- | --- | --- | --- |
| `genoffice/` | 应用本体 | `a1acf05` | 工作分支 `ohos/sota-debrand`（**尚无 tag**） | `github.com/hackeris/genoffice` |
| `electron/` | Electron 本体（HarmonyOS fork） | `3af8ccb` | tag **`ohos-v37.2.0`** | `github.com/hackeris/electron` |

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
# 首次克隆(需 fork 已推送对应分支与 tag)
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

## 风险

### fetch 源指向 `.temp/`

两个 submodule 的 `origin` 目前都是 `file://` 指向 `.temp/` 下的本地副本，
**`.temp/` 一旦清掉，`git submodule update` 就再也拉不回来**。

fork 就绪后执行 `git submodule sync --recursive` 把源切到 fork，这条风险才解除。

### 有两个 commit 不在任何远端

`ohos/sota-debrand` 分支上的两个 commit（`9f22c10`、`a1acf05`）**只存在于本仓的
`.git/modules/` 里**：分支没有 upstream，本地副本里也没有这两个对象，从任何已记录的
remote 都取不到。

在这条分支推到 fork 之前，它一旦丢失就无法恢复。**这是当前仓库最脆弱的一处。**

## 说明

- submodule 记录的是 commit。tag 是静态锚点，作用是让这个 commit 可追溯、可复现。
- `.gitmodules` 里的 `branch` 字段只供 `git submodule update --remote` 跟踪维护分支用，
  它跟 tag 锚定是两回事。
- `engine-ref/`（不入库）是集成方式的参考源兼过渡期的引擎二进制来源，
  正式产物由 `thirdparty/electron` 的构建产出替代（见 `docs/PORT_DESIGN.md` §5.1）。
