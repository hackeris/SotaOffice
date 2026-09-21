# thirdparty 版本锚定

第三方依赖一律 submodule + **release tag** 固定,不得引用 `.temp/` 临时素材。

| 目录 | 依赖 | release tag | commit | remote(fork) |
|---|---|---|---|---|
| `genoffice/` | GenOffice 本体 | **`ohos-v1.0.0`** | `339470d` | `github.com/hackeris/genoffice` |
| `electron/` | Electron 本体(HarmonyOS fork) | **`ohos-v37.2.0`** | `3af8ccb` | `github.com/hackeris/electron` |

tag 语义:
- `genoffice/ohos-v1.0.0` = 上游 `316ded6` + electron 37.2.0 pin(9 文件,`scripts/patches/genoffice-e37-pin.patch` 同源)
- `electron/ohos-v37.2.0` = 官方 fork 分支 `electron-v37.2.0-openharmony` HEAD(Chromium 138 + Node 22)

## 操作

```sh
# 首次克隆(需 fork 已推送对应分支与 tag)
GIT_LFS_SKIP_SMUDGE=1 git submodule update --init        # electron 源含 LFS,跳过

# 校验:submodule 钉的 commit 应正好是 tag 指向
git -C thirdparty/genoffice describe --tags --exact-match   # ohos-v1.0.0
git -C thirdparty/electron describe --tags --exact-match     # ohos-v37.2.0

# fork 推送(tag 随分支一起推,fork 侧执行)
git push origin <分支> && git push origin <tag>
```

## 说明

- submodule 记录的是 commit;tag 锚定保证该 commit 可追溯、可复现。本地 submodule 的
  `origin` 目前指向克隆源路径,fork 就绪后执行 `git submodule sync --recursive` 切到 fork。
- `.gitmodules` 的 `branch` 字段供 `git submodule update --remote` 跟踪维护分支(非 tag,
  tag 为静态锚点)。
- `engine-ref/`(不入库)是集成方式参考源与过渡期引擎二进制来源,产物就绪后由
  `thirdparty/electron` 构建产物替代(见 `docs/PORT_DESIGN.md` §5.1)。
