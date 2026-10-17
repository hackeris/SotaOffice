// Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import window from '@ohos.window';
import Want from '@ohos.app.ability.Want';
import AbilityConstant from '@ohos.app.ability.AbilityConstant';
import { Configuration } from '@ohos.app.ability.Configuration';
import abilityAccessCtrl, { Permissions } from '@ohos.abilityAccessCtrl';
import bundleManager from '@ohos.bundle.bundleManager';
import deviceInfo from '@ohos.deviceInfo';
import { pasteboard, settings } from '@kit.BasicServicesKit';
import { BusinessError } from '@ohos.base';
import fs from '@ohos.file.fs';
import fileUri from '@ohos.file.fileuri';

import { WebAbility } from 'web_engine';

// clip-perm.json 的内容结构(shim 只认 granted 字段)
interface ClipPermSignal {
  granted?: boolean;
}

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
  // 申请时机=场景触发(应用市场审核要求:未见对应功能不得提前申请;官方指引
  // 亦要求弹框前用无权限检查规避无效弹框):应用(经 shim)真正调用剪贴板读侧
  // 时,shim 落 CLIP_REQUEST 触发文件,本侧 watch 到后——已授权静默确认;未授权
  // 先 hasData/getChangeCount 判断(剪贴板无数据或内容未变化时,空读本就是正确
  // 结果,不弹框),确有新内容才 requestPermissionsFromUser。弹框期窗口必然就绪
  // (有 renderer 在跑才有剪贴板调用),不触 onCreate 期申请被系统静默拒绝的坑。
  private static readonly CLIP_SIGNAL = '/data/storage/el2/base/files/clip-perm.json';
  // 触发文件(shim 侧 main-shim.mjs 桩⑭写,内容仅作信号):未授权时 shim 绝不
  // 调用原生剪贴板读侧——调用即触发系统"无法访问系统剪贴板"弹窗(2026-09-22 实测)
  private static readonly CLIP_REQUEST = '/data/storage/el2/base/files/clip-request.json';

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

  private async isClipPermGranted(): Promise<boolean> {
    try {
      const info = await bundleManager.getBundleInfoForSelf(
        bundleManager.BundleFlag.GET_BUNDLE_INFO_WITH_APPLICATION);
      const tokenId = info.appInfo?.accessTokenId;
      if (!tokenId) {
        return false;
      }
      const st = await abilityAccessCtrl.createAtManager()
        .checkAccessToken(tokenId, 'ohos.permission.READ_PASTEBOARD');
      return st === abilityAccessCtrl.GrantStatus.PERMISSION_GRANTED;
    } catch (e) {
      // 权限未声明/未获批时 checkAccessToken 抛错 → 按未授权处理
      return false;
    }
  }

  // 冷启动重置授权信号(无弹框):已授予 → 写 granted,shim 直接恢复读侧;
  // 未授予 → 删掉上一会话的拒绝记录,本会话用户仍有被询问的机会
  private resetClipboardGrantState(): void {
    this.isClipPermGranted().then((granted: boolean) => {
      if (granted) {
        this.writeClipSignal(true);
        return;
      }
      try {
        fs.unlinkSync(EntryAbility.CLIP_SIGNAL);
      } catch (e) {
        // 本就没有
      }
    });
  }

  // 会话内已申请过的剪贴板版本(官方 getChangeCount 规避:内容未变化不重复弹框)
  private lastClipChangeCount: number = -1;
  private clipPermDialogActive: boolean = false;

  private async handleClipGrantRequest(): Promise<void> {
    // 先删触发文件:弹框挂起期间 shim 再写会再触发,本方法幂等可重入
    try {
      fs.unlinkSync(EntryAbility.CLIP_REQUEST);
    } catch (e) {
      // shim 已删/竞态,无碍
    }
    if (this.clipPermDialogActive) {
      return;
    }
    try {
      const perm: ClipPermSignal =
        JSON.parse(fs.readTextSync(EntryAbility.CLIP_SIGNAL)) as ClipPermSignal;
      if (perm?.granted === true || perm?.granted === false) {
        // true:shim 已恢复;false:用户本会话已拒绝,静默
        return;
      }
    } catch (e) {
      // 无结论,继续
    }
    if (await this.isClipPermGranted()) {
      this.writeClipSignal(true);
      return;
    }
    // 官方"剪贴板弹窗适配优化":无数据/内容未变化不访问、不弹框
    const sysPaste = pasteboard.getSystemPasteboard();
    let hasData = false;
    try {
      hasData = await sysPaste.hasData();
    } catch (e) {
      return;
    }
    if (!hasData) {
      return;
    }
    const changeCount = sysPaste.getChangeCount();
    if (changeCount === this.lastClipChangeCount) {
      return;
    }
    this.clipPermDialogActive = true;
    try {
      const perms: Array<Permissions> = ['ohos.permission.READ_PASTEBOARD'];
      const res = await abilityAccessCtrl.createAtManager()
        .requestPermissionsFromUser(this.context, perms);
      // authResults[0]===0 为用户已允许
      const granted = res.authResults.length > 0 && res.authResults[0] === 0;
      this.lastClipChangeCount = changeCount;
      this.writeClipSignal(granted);
    } catch (e) {
      console.warn(`clipboard perm request: ${JSON.stringify(e)}`);
    } finally {
      this.clipPermDialogActive = false;
    }
  }

  // 常驻监视(1s 一查,单次 stat;应用退出随进程消亡)。shim 写触发文件 → 走申请
  private watchClipGrantRequest(): void {
    let requested = false;
    try {
      fs.accessSync(EntryAbility.CLIP_REQUEST);
      requested = true;
    } catch (e) {
      requested = false;
    }
    if (requested) {
      this.handleClipGrantRequest();
    }
    setTimeout((): void => this.watchClipGrantRequest(), 1000);
  }

  // PC 模式判定:tablet 的桌面形态(sceneboard 字段)。非 tablet 或读取失败均按
  // 非 PC 处理,维持各调用点的既有行为
  private isPcModeOnTablet(): boolean {
    if (deviceInfo.deviceType !== 'tablet') {
      return false;
    }
    try {
      return settings.getValueSync(this.context, 'settings.sceneboard.ispcmode', 'false',
        settings.domainName.USER_PROPERTY) === 'true';
    } catch (e) {
      console.warn(`[immersive] pc mode check failed: ${JSON.stringify(e)}`);
      return false;
    }
  }

  // 沉浸式(平板形态):隐藏状态栏/通知栏,应用内容全屏。仅平板形态会调到本方法
  // (调用分支已用 isPcModeOnTablet 拦掉 2in1 与 PC 模式)——桌面形态有系统 UI
  // 概念的都不走全屏沉浸。与 enableSystemDecor 同款重试:Chromium 创建平台窗口
  // 时可能重置窗口状态,无事件锚点,幂等多次覆盖。
  private applyImmersiveForTablet(windowStage: window.WindowStage): void {
    if (deviceInfo.deviceType !== 'tablet') {
      return;
    }
    const apply = (tag: string): void => {
      try {
        const win = windowStage.getMainWindowSync();
        win.setWindowSystemBarEnable([]);
        console.info(`[immersive] system bars hidden(${tag})`);
      } catch (e) {
        console.warn(`[immersive] ${tag} failed: ${JSON.stringify(e)}`);
      }
    };
    for (const delay of [800, 1500, 3000]) {
      setTimeout((): void => apply(`${delay}ms`), delay);
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

  // 弹框时机:主界面加载完成后延迟 2s 再申请。启动即弹会盖在未加载的白屏上,
  // 拖慢首屏(2026-09-26 实测)。主界面就绪的信号由 Electron 主进程落标记文件
  // (index.ts 主窗口 did-finish-load → ui-ready);此处先删旧标记(避免吃到
  // 上一次启动遗留),再 500ms 轮询,最长 60s;超时跳过本轮申请(未授权走
  // shim 降级 el2 的既有兜底,下次启动再弹)。
  private static readonly UI_READY_FILE: string = '/data/storage/el2/base/files/ui-ready';

  private pollUiReadyAndRequestStorage(attempt: number): void {
    let ready = false;
    try {
      fs.accessSync(EntryAbility.UI_READY_FILE);
      ready = true;
    } catch (e) {
      ready = false;
    }
    if (ready) {
      setTimeout(() => this.requestStoragePermissions(), 2000);
      return;
    }
    if (attempt >= 120) {
      console.warn('ui-ready 未出现(60s),本轮跳过三目录申请');
      return;
    }
    setTimeout(() => this.pollUiReadyAndRequestStorage(attempt + 1), 500);
  }

  onWindowStageCreate(windowStage: window.WindowStage) {
    super.onWindowStageCreate(windowStage);
    // 剪贴板授权不在此申请(启动即弹框被应用市场审核驳回):重置信号 + 起常驻
    // 监视,申请时机由 shim 的剪贴板读侧调用触发(场景触发,详见各方法注释)
    this.resetClipboardGrantState();
    this.watchClipGrantRequest();
    try {
      fs.unlinkSync(EntryAbility.UI_READY_FILE);
    } catch (e) {
      // 首启本就无此文件
    }
    this.pollUiReadyAndRequestStorage(0);
    if (deviceInfo.deviceType === 'tablet' && !this.isPcModeOnTablet()) {
      // 平板形态(非 PC 模式):无系统三键,decor 与按钮矩形上报均不适用——矩形误报
      // 全宽会让 shim 桩⑮注入全宽右上避让,把 tab 条挤压成 0;残留矩形文件一并清除
      try {
        fs.unlinkSync(EntryAbility.BUTTON_RECT_FILE);
      } catch (e) {
        // 本就没有
      }
      this.applyImmersiveForTablet(windowStage);
    } else {
      // 2in1 与平板的 PC 模式同为桌面形态,须补设 decor(Chromium 平台窗口会吃掉
      // loadContent 时的装饰声明,tablet PC 模式 2026-10-11 实测无标题栏即此因);
      // 三按钮真实存在,按钮矩形上报照常
      this.enableSystemDecor(windowStage);
      try {
        this.updateTitleButtonRect(windowStage.getMainWindowSync());
      } catch (e) {
        console.warn(`title button rect init: ${JSON.stringify(e)}`);
      }
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
