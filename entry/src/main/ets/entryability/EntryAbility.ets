// Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import window from '@ohos.window';
import Want from '@ohos.app.ability.Want';
import AbilityConstant from '@ohos.app.ability.AbilityConstant';
import { Configuration } from '@ohos.app.ability.Configuration';
import abilityAccessCtrl, { Permissions } from '@ohos.abilityAccessCtrl';
import bundleManager from '@ohos.bundle.bundleManager';
import { BusinessError } from '@ohos.base';
import fs from '@ohos.file.fs';
import fileUri from '@ohos.file.fileuri';

import { WebAbility } from 'web_engine';

export default class EntryAbility extends WebAbility {
  onConfigurationUpdate(config: Configuration) {
    super.onConfigurationUpdate(config);
  }

  // 文件关联(系统"打开方式"拉起):want.uri 是待打开文件。
  // 引擎 initParameters 会把 want.uri 当 startUri(网页应用场景,可能触发网页导航),
  // 必须改道:转真实路径塞进 cmdArgs(→ CommandLineAdapter → Chromium argv →应用按
  // supportedFileIn(process.argv) 打开),同时清空 startUri 防误用。
  // 多实例(launchType=multiton)下每次打开都是新实例,无需处理 onNewWant 热路径。
  private resolveDocumentPath(want: Want): string {
    const uri: string = want.uri as string;
    if (uri === undefined || uri === null || !uri.startsWith('file://')) {
      return '';
    }
    try {
      return new fileUri.FileUri(uri).path;
    } catch (e) {
      console.warn(`open-document parse: ${JSON.stringify(e)}`);
      return '';
    }
  }

  private applyOpenDocument(want: Want): void {
    const path: string = this.resolveDocumentPath(want);
    if (path === '') {
      return;
    }
    this.startUri = '';
    this.cmdArgs.push(path);
    console.info(`open-document: ${path}`);
  }

  // 文件关联热启动(应用已在运行时打开文件):系统复用本实例并回调 onNewWant。
  // 引擎只在启动期消费 cmdArgs,运行时无注入通道 → 写信号文件,由 shim(桩⑰)
  // 经应用自带的 control-server 发 open 命令,在现有窗口打开。
  private static readonly OPEN_DOC_FILE: string = '/data/storage/el2/base/files/open-doc.json';

  onNewWant(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    const path: string = this.resolveDocumentPath(want);
    if (path === '') {
      return;
    }
    try {
      const f = fs.openSync(EntryAbility.OPEN_DOC_FILE,
        fs.OpenMode.CREATE | fs.OpenMode.READ_WRITE | fs.OpenMode.TRUNC);
      fs.writeSync(f.fd, JSON.stringify({ path: path, seq: Date.now() }));
      fs.closeSync(f);
      console.info(`open-document(hot): ${path}`);
    } catch (e) {
      console.warn(`open-doc signal: ${JSON.stringify(e)}`);
    }
  }

  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam) {
    super.onCreate(want, launchParam);
    // 声明意图:窗口带系统装饰、三按钮可用。web_engine 里 hideTitleBar 门控装饰与按钮
    // (`按钮 && !hideTitleBar`);实际生效靠 onWindowStageCreate 的 enableSystemDecor
    // (Chromium 创建平台窗口会重置装饰,须在其后重设——详见该方法注释)
    this.hideTitleBar = false;
    this.minimizable = true;
    this.maximizable = true;
    this.closable = true;
    this.applyOpenDocument(want);
  }

  onDestroy() {
    super.onDestroy();
  }

  // READ_PASTEBOARD 是 user_grant:签名 ACL 只给申请资格,授予须用户点头。
  // 启动即申请(已授予静默跳过);必须在窗口就绪后——onCreate 期无处挂授权框,
  // 系统静默拒绝且记账,后续真窗口期申请会被限频。
  private clipboardPermRequested: boolean = false;

  // 授权信号文件(shim 侧 main-shim.mjs 读同路径):未授权时 shim 绝不调用原生
  // 剪贴板读侧——调用即触发系统"无法访问系统剪贴板"弹窗(2026-09-22 实测)
  private static readonly CLIP_SIGNAL = '/data/storage/el2/base/files/clip-perm.json';

  private writeClipSignal(granted: boolean): void {
    try {
      const f = fs.openSync(EntryAbility.CLIP_SIGNAL,
        fs.OpenMode.CREATE | fs.OpenMode.READ_WRITE | fs.OpenMode.TRUNC);
      fs.writeSync(f.fd, JSON.stringify({ granted: granted }));
      fs.closeSync(f);
    } catch (e) {
      console.warn(`clip signal write: ${JSON.stringify(e)}`);
    }
  }

  private requestClipboardPermission(): void {
    if (this.clipboardPermRequested) {
      return;
    }
    this.clipboardPermRequested = true;
    try {
      const atm = abilityAccessCtrl.createAtManager();
      bundleManager.getBundleInfoForSelf(bundleManager.BundleFlag.GET_BUNDLE_INFO_WITH_APPLICATION)
        .then((info: bundleManager.BundleInfo) => {
          const tokenId = info.appInfo?.accessTokenId;
          if (!tokenId) {
            return undefined;
          }
          return atm.checkAccessToken(tokenId, 'ohos.permission.READ_PASTEBOARD');
        })
        .then((st: abilityAccessCtrl.GrantStatus | undefined) => {
          if (st !== undefined && st === abilityAccessCtrl.GrantStatus.PERMISSION_GRANTED) {
            this.writeClipSignal(true);
            return;
          }
          const perms: Array<Permissions> = ['ohos.permission.READ_PASTEBOARD'];
          atm.requestPermissionsFromUser(this.context, perms)
            .then((res) => {
              // authResults[0]===0 为用户已允许
              const granted = res.authResults.length > 0 && res.authResults[0] === 0;
              this.writeClipSignal(granted);
            })
            .catch((e: BusinessError) => {
              this.writeClipSignal(false);
              console.warn(`clipboard perm request: ${JSON.stringify(e)}`);
            });
        })
        .catch((e: BusinessError) => {
          // 权限未声明/未获批时 checkAccessToken 抛错 → 明确告知 shim 保持静默
          this.writeClipSignal(false);
          console.warn(`clipboard perm check: ${JSON.stringify(e)}`);
        });
    } catch (e) {
      this.writeClipSignal(false);
      console.warn(`clipboard perm precheck: ${JSON.stringify(e)}`);
    }
  }

  // 系统窗口装饰(2026-09-23):Electron 桌面版靠 titleBarOverlay(Win/Linux)/交通灯
  // (macOS)由系统绘制窗口按钮;OHOS fork 无此机制。web_engine 虽在 loadContent 回调
  // 调过 setWindowDecorVisible(!hideTitleBar)(hideTitleBar 默认 false → true),但
  // **随后 Chromium 创建平台窗口(OhosToplevelWindow)时会把它重置**——实测真机装饰
  // 不出现,须待窗口创建之后再设一次。ArkTS 侧无"平台窗口已创建"的事件锚点,故用
  // 幂等多次重试覆盖该不确定时刻;生效后系统标题栏提供鼠标/触屏可达的
  // 最小化/最大化/关闭(关闭走 win.close() → 脏数据检查链,实测 exit code 0)。
  private enableSystemDecor(windowStage: window.WindowStage): void {
    const apply = (tag: string): void => {
      try {
        const win = windowStage.getMainWindowSync();
        // 隐藏标题栏 → 应用内容(自绘 tab 条)延展到窗口顶部;三按钮保留,悬浮在右上角
        win.setWindowDecorVisible(false);
        // 该高度即三键区高度(可设范围 37~112):取应用 tab 条高度 40,按钮中心
        // 才能与 tab 条中心重合(设 48 时实测按钮中心低 4vp)
        win.setWindowDecorHeight(40);
        win.setWindowTitleButtonVisible(true, true, true);
        // 装饰隐藏后,鼠标 hover 顶部热区默认会浮出标题栏——禁用,保持 WCO 式观感
        try {
          win.setTitleAndDockHoverShown(false, false);
        } catch (e) { /* 低版本无此 API,忽略 */ }
        console.info(`[decor] applied(${tag})`);
      } catch (e) {
        console.warn(`[decor] ${tag} failed: ${JSON.stringify(e)}`);
      }
    };
    for (const delay of [800, 1500, 3000]) {
      setTimeout((): void => apply(`${delay}ms`), delay);
    }
  }

  // 标题按钮区宽度上报(shim 据此注入避让 CSS)
  //
  // 桌面 Electron 把窗口按钮区信息以 CSS `env(titlebar-area-*)` 交给应用,应用按它
  // 让出右上角(shell tab 条右端的 .tab-bar-caption-spacer)——OHOS 引擎不提供该变量,
  // 应用算出的避让宽度恒为 0,右上角控件与系统三按钮重叠。这里把系统给的
  // windowTitleButtonRectChange 矩形落到文件,shim 注入等宽 CSS 补上这一环。
  private static readonly BUTTON_RECT_FILE: string =
    '/data/storage/el2/base/files/title-button-rect.json';

  private updateTitleButtonRect(win: window.Window): void {
    try {
      win.on('windowTitleButtonRectChange', (rect: window.TitleButtonRect) => {
        try {
          const f = fs.openSync(EntryAbility.BUTTON_RECT_FILE,
            fs.OpenMode.CREATE | fs.OpenMode.READ_WRITE | fs.OpenMode.TRUNC);
          fs.writeSync(f.fd, JSON.stringify({
            right: rect.right, top: rect.top, width: rect.width, height: rect.height
          }));
          fs.closeSync(f);
        } catch (e) {
          console.warn(`title button rect write: ${JSON.stringify(e)}`);
        }
      });
    } catch (e) {
      console.warn(`title button rect listen: ${JSON.stringify(e)}`);
    }
  }

  // 三目录(READ_WRITE_{DOCUMENTS,DOWNLOAD,DESKTOP}_DIRECTORY)同为 **user_grant**:
  // 声明 + profile ACL 只给"申请资格",须运行时弹窗授予——否则写 /storage/Users/currentUser/*
  // 报 EPERM(2026-09-24 实测:未申请时三目录全 EPERM,shim 第⑦桩降级 el2)。
  private requestStoragePermissions(): void {
    const perms: Array<Permissions> = [
      'ohos.permission.READ_WRITE_DOCUMENTS_DIRECTORY',
      'ohos.permission.READ_WRITE_DOWNLOAD_DIRECTORY',
      'ohos.permission.READ_WRITE_DESKTOP_DIRECTORY',
    ];
    try {
      abilityAccessCtrl.createAtManager()
        .requestPermissionsFromUser(this.context, perms)
        .then((res) => { console.info(`storage perm: ${JSON.stringify(res.authResults)}`) })
        .catch((e: BusinessError) => { console.warn(`storage perm: ${JSON.stringify(e)}`) });
    } catch (e) {
      console.warn(`storage perm precheck: ${JSON.stringify(e)}`);
    }
  }

  onWindowStageCreate(windowStage: window.WindowStage) {
    super.onWindowStageCreate(windowStage);
    this.requestClipboardPermission();
    this.requestStoragePermissions();
    this.enableSystemDecor(windowStage);
    try {
      this.updateTitleButtonRect(windowStage.getMainWindowSync());
    } catch (e) {
      console.warn(`title button rect init: ${JSON.stringify(e)}`);
    }
  }

  onWindowStageDestroy() {
    super.onWindowStageDestroy();
  }

  onForeground() {
    super.onForeground();
  }

  onBackground() {
    super.onBackground();
  }
};
