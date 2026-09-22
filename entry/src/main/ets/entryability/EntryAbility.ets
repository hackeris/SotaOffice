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

import { WebAbility } from 'web_engine';

export default class EntryAbility extends WebAbility {
  onConfigurationUpdate(config: Configuration) {
    super.onConfigurationUpdate(config);
  }

  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam) {
    super.onCreate(want, launchParam);
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

  onWindowStageCreate(windowStage: window.WindowStage) {
    super.onWindowStageCreate(windowStage);
    this.requestClipboardPermission();
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
