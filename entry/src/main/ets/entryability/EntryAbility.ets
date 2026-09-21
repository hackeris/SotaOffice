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
            return;
          }
          const perms: Array<Permissions> = ['ohos.permission.READ_PASTEBOARD'];
          atm.requestPermissionsFromUser(this.context, perms);
        })
        .catch((e: BusinessError) => {
          console.warn(`clipboard perm: ${JSON.stringify(e)}`);
        });
    } catch (e) {
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
