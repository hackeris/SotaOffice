# 附录 C:hos_vscodium / Electron-OHOS 运行时工程细节

> 来源:2026-09-19 对运行时底座工程(`.temp/hos_vscodium`)的克隆分析。它把 VSCodium 1.126.0 跑在 openharmony-sig/electron `electron-v37.2.0-openharmony`(Chromium 138.0.7204.45 + Node 22.17.0)上,经 2in1 真机验证。**web_engine HAR 是本项目 A 路线的运行时底座。**

## 1. 运行时形态(web_engine HAR)

- HAR 模块,无 C++ 源码;三大预编译 so:`libelectron.so`(~170MB,含 NEEDED libadapter/libffmpeg)、`libadapter.so`(2.6MB,ArkTS↔native 桥 + ~50 adapter,NEEDED libace_napi 等)、`libffmpeg.so`(2.2MB)。
- resfile(~18MB):resources.pak/icudtl.dat(10M)/snapshot_blob.bin/v8_context_snapshot.bin/locales/{en-US,zh-CN}.pak/vulkan ICD + 8KB `electron` 启动器。
- ArkTS import 方式:`import adapter from 'libadapter.so'`(仅导出 getNativeContext/SetContextPaths)。

## 2. 启动链

```
AbilityStage(WebAbilityStage.runTaskAsync: initNativeContext + SetContextPaths)
→ EntryAbility(继承 WebAbility;窗口事件→nativeContext.OnWindowRectChange)
→ WebWindowNode.ets: XComponent(libraryname="adapter") 装载 libadapter.so
   onLoad: appendSwitch('bundle-installation-dir', resourceDir) + nativeContext.runBrowser(argv)
→ libadapter 走 appspawn 协议 fork 出 electron 启动器(继承应用身份/沙箱)
→ 启动器(node.c 模板 15 行): setenv LD_LIBRARY_PATH=/data/storage/el1/bundle/libs/arm64
   → chdir(resfile) → ElectronMain(argc,argv) [来自 libelectron.so]
→ 载入 resfile/resources/app/package.json 的 main
```

argv 默认:`--use-gl=egl --enable-features=UseOzonePlatform --ozone-platform=ohos --no-zygote --user-data-dir=/data/storage/el2/base/files/ --disable-gpu-watchdog --bundle-installation-dir=<resfile> --electron-exec-path-ohos=<metadata>`;`electron_exec_path_ohos` 经 module.json5 metadata 传递。窗口 Want 参数 `cmdArgs` 可传业务 argv。

module.json5 关键四件套(entry):`executableBinaryPaths`(注册 electron/node/bin/*)、`extractNativeLibs: true`、`compressNativeLibs: false`、metadata `electron_exec_path_ohos`。

## 3. 应用打包形态

- app 解包目录进 entry resfile(VSCodium 284MB:out/、node_modules.asar、extensions/);resfile 在 HAP 内不压缩、JS 直接按路径读。
- 原生模块不进 asar,放 `libs/arm64-v8a/`(安装到 /data/storage/el1/bundle/libs/arm64/);fork 的 NODE_PATH 搜索 `node_modules.asar.unpacked:libs/arm64`。
- **每个 `.node` 必须有同内容 `.so` 别名**(安装器只给 *.so 注册签名,.node 过 XPM 失败;fork node_binding.cc dlopen 失败回退 .so)。GenOffice 零 .node,基本无关。
- 可执行文件(bash/zsh/rg/electron/node)全部注册 executableBinaryPaths(→ 二进制证书体系,见主文档 §4)。

## 4. main-shim.mjs 六件事(模板)

1. `process.platform` mock 为 `'linux'`(fork 报 `openharmony`;VS Code initServices 按 platform switch 漏注册自杀——**Genoffice 需排查同类分支**);
2. `process.title` mock(OHOS 无 setproctitle);
3. HOME/XDG/VSCODE_PORTABLE 指沙箱 + `--force-disable-user-env`(execPath=/system/bin/appspawn 不可直接执行,env probe 会 exit 126);
4. powerMonitor 监听守卫(fork 缺 `setListeningForShutdown` 会 abort);
5. BrowserWindow WCO 方法打桩(setTitleBarOverlay 等,prototype + 实例双层);
6. **主进程原生模块预加载**(fork 在窗口起来后销毁主进程 JS VM,之后首次 dlopen .node 会 `ecma_vm destructed` abort)。

GenOffice 预计需要:1/2/3 通用;4/5 视触达;6 无 .node 可能不需要(待验证 worker_threads/懒加载行为)。

## 5. napi-dyn 转发层(备用基建)

libelectron.so 以 RTLD_LOCAL 加载,napi 符号不在全局作用域;原生模块自带转发层:`constructor dlopen("libelectron.so", RTLD_NOLOAD) + dlsym 全部 napi 函数`(145 个,脚本从 node headers ∩ libelectron 导出自动生成),编译加 `-include napi-dyn.h` + `-Wl,-Bsymbolic`,产物零未定义 napi 符号。**GenOffice 零 napi 模块,大概率用不上**;若 M3 CLI/Rust 需要进程内 napi 再取 `native/` 模板。

## 6. 构建与签名

- `scripts/build-variants.sh`:sed 改 bundleName → 内嵌 python 重写 signingConfigs material → `devecocli build` → 拷 HAP。
- 首次签名:`devecocli signature generate --product default`(设备在线)。
- 离线重签:`sign.js`(hvigor DecipherUtil 独立版,PBKDF2+AES-GCM 解密签名口令)+ `sign.py`(调 SDK hap-sign-tool.jar)。
- 大文件 Git LFS(.gitattributes: *.so/*.node/*.pak/*.dat/*.bin/*.wasm)。

## 7. 已知引擎级缺陷(继承自 fork,无代码修复)

- IME 键盘输入个别场景异常(依赖系统 IME 文本提交);
- 退出时偶发 dlclose 崩溃;
- `media(hover: none)` 导致少量 UI 元素不显示(**GenOffice 的 renderer 需查 hover 依赖并加 ohos 条件样式**);
- ObjectWrap 构造即崩(spdlog 被移除、sqlite3 纯 C 重写)——GenOffice 无 .node,不涉及。

## 8. GenOffice 复用清单

**直接搬**:web_engine/ 整目录(HAR+oh-package+hvigorfile)、entry 骨架(AbilityStage/EntryAbility/CustomChildProcess/pages/Index)、electron/node 启动器二进制 + node.c 模板(改 chdir)、crash-hook.c、build-variants.sh/sign.py/sign.js。

**按应用重做**:resfile/resources/app/(GenOffice 打包产物)、main-shim.mjs(六件事按需裁剪)、权限清单(见主文档 §4,裁掉 CLI/传感器类)、AppScope(bundleName/图标/版本)。

**三个注意**:.node→.so 别名 + soname(不适用,无 .node);主进程模块预加载;子进程可执行必须 executableBinaryPaths + appspawn fork,chdir 限 /data/storage 之下。
