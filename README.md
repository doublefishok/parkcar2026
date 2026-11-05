# 邻里车位 · 社区闲置车位分时共享小程序

> 业主把空闲车位按时段租给邻居/访客，微信小程序下单支付，车牌自动放行道闸，物业负责产权审核与分账。

- **技术栈**：微信原生小程序 + 云开发（云函数 + 云数据库）
- **零服务器**：不需要买服务器、不需要域名备案、不需要 SSL 证书
- **开箱可跑**：默认演示模式，用微信开发者工具打开就能跑通完整业务流程
- **31 项回归测试**：`node tests/cloud-test.js`

---

## 一、目录结构

```
linli-parking/
├── project.config.json          开发者工具项目配置（导入这个目录）
├── README.md
├── miniprogram/                 ← 小程序前端
│   ├── app.js / app.json / app.wxss
│   ├── config.js                ★ 开关：USE_MOCK / CLOUD_ENV
│   ├── utils/
│   │   ├── api.js               统一接口层（Mock ⇄ 云函数自动切换）
│   │   ├── util.js              日期、计价、视图构建
│   │   └── mock.js              本地模拟后端（完整业务逻辑）
│   └── pages/
│       ├── index/               首页 · 身份切换 · 入口
│       ├── find/                租客 · 找车位
│       ├── detail/              租客 · 预约下单 + 支付
│       ├── orders/              租客 · 我的订单（通行码）
│       ├── host/                业主 · 车位 / 发布时段 / 收益
│       ├── property/            物业 · 放行名单 / 审核 / 看板
│       └── profile/             我的 · 身份切换 / 说明
├── cloudfunctions/              ← 云函数（6 个）
│   ├── login/                   登录、用户资料、角色
│   ├── spot/                    车位列表、详情、备案、审核
│   ├── slot/                    空闲时段发布 / 下架
│   ├── order/                   下单、支付、取消、入场、结算
│   ├── access/                  道闸白名单、车牌核验、通行流水
│   └── admin/                   物业经营看板
├── shared/
│   ├── cloudfn-common.js        云函数公共库（计价/视图/校验）
│   └── sync-cloudfn.js          把公共库同步进各云函数目录
├── database/                    数据库集合说明与种子数据
└── tests/                       云函数回归测试（内存版数据库）
```

---

## 二、快速开始

### 方式 A：5 分钟看效果（演示模式，**不需要云开发**）

1. 安装 [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)
2. 「导入项目」→ 目录选择本仓库的 `linli-parking/` 文件夹
3. AppID 选择「测试号」（或填自己的 AppID）
4. 直接点「编译」即可运行

此时 `miniprogram/config.js` 中 `USE_MOCK: true`，所有数据走本地 Storage，逻辑与云函数完全一致。

**建议的演示路径：**

| 步骤 | 操作 | 看到什么 |
|---|---|---|
| 1 | 首页 → 我要停车 | 明天/后天有可租车位 |
| 2 | 选一个车位 → 填车牌 → 立即支付 | 生成 6 位通行码 |
| 3 | 我的订单 → 模拟入场 | 道闸抬杆、记录入场 |
| 4 | 我的订单 → 模拟出场结算 | 结算完成，业主获得 75% |
| 5 | 首页 → 物业后台 → 放行名单 | 输入车牌 `沪A·2K78` 可核验放行 |
| 6 | 物业后台 → 车位审核 | 通过/驳回待审车位 |
| 7 | 物业后台 → 经营看板 | GMV、平台/物业/业主三方分账 |
| 8 | 首页 → 出租我的车位 | 一键发布周末两天、看收益 |
| 9 | 我的 → 重置数据 | 恢复初始演示数据 |

> 演示数据每天自动按当天日期生成（今天/明天/后天），今天固定有一笔已支付订单可直接用于道闸核验。

### 方式 B：接入云开发（正式上线）

1. **注册小程序**：需要**企业或个体工商户主体**（个人主体不能用微信支付，停车类目也需资质）
2. **改 AppID**：把 `project.config.json` 里的 `"appid": "touristappid"` 改成你的 AppID
3. **开通云开发**：开发者工具顶部「云开发」→ 开通 → 新建环境（建议按量付费），记下**环境 ID**
4. **改配置**：`miniprogram/config.js`
   ```js
   USE_MOCK: false,
   CLOUD_ENV: '你的环境ID',
   ALLOW_MOCK_PAY: false
   ```
5. **建集合**：云开发控制台 → 数据库 → 新建 6 个集合
   `communities`、`users`、`spots`、`slots`、`orders`、`access_logs`
   每个集合权限设为 **「仅管理端可读写」**（所有读写都走云函数，前端不直连数据库）
6. **部署云函数**：在开发者工具左侧 `cloudfunctions` 下，对 6 个函数逐个右键 →
   **「上传并部署：云端安装依赖」**
7. **导入种子数据**：见 [`database/README.md`](database/README.md)
8. **设置物业账号**：在 `users` 集合里把你自己的账号加一个字段 `isAdmin: true`，
   否则无法切换物业身份（见下方权限说明）
9. **建索引**（重要，否则数据量上来会慢）：
   - `orders`: `renterOpenid + createdAt`、`ownerOpenid + createdAt`、`status`、`date`
   - `slots`: `date + status`、`spotId`
   - `spots`: `ownerOpenid`、`status`

---

## 三、云函数接口一览

所有云函数统一入参 `{ action, ...params }`，统一返回 `{ code, data, msg }`（`code === 0` 为成功）。

| 云函数 | action | 说明 |
|---|---|---|
| `login` | `profile` | 静默登录，首次自动建档，返回用户 + 小区配置 |
| | `setRole` | 切换身份（切物业需 `isAdmin`） |
| `spot` | `list` | 按日期查可租车位（含车位信息 + 价格视图） |
| | `detail` | 时段详情 |
| | `my` | 我的车位 + 我发布的时段 |
| | `apply` | 车位备案申请（待审核） |
| | `update` | 修改时价 / 日封顶 |
| | `pending` | 物业：待审核列表 |
| | `approve` / `reject` | 物业：通过 / 驳回 |
| `slot` | `publish` | 发布自定义时段（含时段重叠校验） |
| | `publishWeekend` | 一键发布本周末两天 08:00–20:00 |
| | `unpublish` | 下架（已被预约则拒绝） |
| `order` | `create` | 下单（**原子锁定**时段，防并发抢单） |
| | `pay` | 支付成功 → 生成通行码 → 时段置 booked |
| | `cancel` | 取消未支付订单并释放时段 |
| | `list` | 租客 / 业主订单列表 |
| | `checkin` / `checkout` | 入场核销 / 出场结算（含超时费） |
| `access` | `whitelist` | 物业：当前应放行车辆清单 |
| | `verify` | 按车牌核验是否放行 + 写入通行流水 |
| | `logs` | 通行流水 |
| `admin` | `stats` | GMV、出租率、三方分账、在场车辆 |

> 云函数公共代码在 `shared/cloudfn-common.js`。**修改后必须运行** `node shared/sync-cloudfn.js`，
> 因为云函数部署时只上传各自目录。

---

## 四、数据模型

### `communities`
```js
{ name, address, households, totalSpots, barrier, barrierMode, split: { platform, property, owner } }
```

### `users`
```js
{ _openid, nickName, phone, role: 'renter'|'owner'|'property', building, isAdmin }
```

### `spots`（车位）
```js
{ _openid, ownerOpenid, building, spotNo, plate, pricePerHour, dayCap,
  certType: '产权车位'|'月租车位', status: 'pending'|'approved'|'rejected',
  verifiedAt, approvedBy }
```

### `slots`（空闲时段）
```js
{ spotId, ownerOpenid, date: '2026-11-07', from: '08:00', to: '20:00',
  status: 'available'|'locked'|'booked'|'cancelled' }
```

### `orders`
```js
{ orderNo, slotId, spotId, ownerOpenid, renterOpenid, renterName, renterPhone, plate,
  date, from, to, baseAmount, extraAmount,
  status: 'unpaid'|'paid'|'checked_in'|'finished'|'cancelled'|'refunded',
  code, payId, createdAt, paidAt, inAt, outAt, finishedAt }
```

### `access_logs`
```js
{ orderId, plate, type: 'in'|'out'|'denied', gate, source: 'verify'|'manual'|'barrier', at, operator }
```

---

## 五、关键业务规则（已实现）

| 规则 | 实现位置 | 为什么重要 |
|---|---|---|
| **计价** `min(时长×时价, 日封顶)` | `common.calcPrice` | 日租有封顶，业主和租客都能接受 |
| **原子锁单** | `order/create` 用条件更新 `where({_id, status:'available'})` | 两个租客同时下单只有一个成功 |
| **未支付 15 分钟自动释放** | `order` 云函数 `cleanupUnpaid()` | 防止时段被占用不付款 |
| **通行窗口** 开始前 30 分钟生效、结束时刻失效 | `access/verify` | 防止提前占位、防止赖着不走 |
| **超时费** 1.5 倍时价 | `common.extraFeeOf` | 不用物业拦车，出场自动补扣 |
| **分账** 平台 10% / 物业 15% / 业主 75% | `common.SPLIT` | 物业配合的经济基础 |
| **不能预约自己的车位** | `order/create` | 防刷单 |
| **时段重叠校验** | `slot/publish` | 防止同一车位卖出两份 |
| **人防车位提示** | 备案页 + 审核页 | 规避违规转租风险 |

---

## 六、接入真实微信支付

当前 `order/pay` 是**演示支付**（直接把订单置为已支付）。生产环境改成下面三步：

1. **开通微信支付**，绑定商户号 `MCHID`，在小程序后台关联
2. 在 `cloudfunctions/order/index.js` 新增 action `prepay`：
   ```js
   const r = await cloud.cloudPay.unifiedOrder({
     body: '小区车位租赁',
     outTradeNo: order.orderNo,
     spbillCreateIp: '127.0.0.1',
     subMchId: '你的商户号',
     totalFee: order.baseAmount * 100,   // 单位：分
     envId: cloud.DYNAMIC_CURRENT_ENV,
     functionName: 'pay-notify'          // 支付回调云函数
   });
   return common.ok({ payment: r.payment });
   ```
3. 小程序端 `detail.js` 里把「直接调用 pay」换成：
   ```js
   wx.requestPayment(Object.assign(payment, {
     success: () => { /* 跳订单页 */ },
     fail: () => { /* 提示 */ }
   }))
   ```
4. 新增云函数 `pay-notify`：接收微信支付回调，在回调里把订单置为 `paid`、生成通行码、时段置 `booked`。
   **注意：通行码必须在支付回调里生成，不能在前端生成。**

---

## 七、接入道闸（三种方案）

| 层级 | 物业提供 | 你要做的 | 上线速度 |
|---|---|---|---|
| **L1 人工配合** | 保安拿到放行名单，人工抬杆 | 物业后台「复制名单」→ 发到物业群 / 打印 | 当天 |
| **L2 系统白名单** | 物业能把车牌录进道闸后台 | 每 10 分钟把 `access/whitelist` 结果导出，供物业批量导入 | 1–3 天 |
| **L3 API 直连** | 道闸厂商开放接口 | 写一个定时云函数拉白名单 → 调厂商 API 下发；道闸进出记录回调 `access/verify` | 2 周起 |

> 代码已经按「**生成一份带时效的放行白名单**」来设计，所以从 L1 升到 L3 不用改业务逻辑，只加一个下发适配器。

**选型建议**：先按 L1 跑两周验证真实需求，再决定要不要花钱做 L3。
道闸厂商常见开放平台：捷顺、科拓、富士、红门、蓝卡、ETCP —— 谈之前先问清「是否支持白名单 API 和进出记录回调」。

---

## 八、合规与风险清单（上线前必须逐条确认）

- [ ] 小程序主体为**企业/个体户**，类目与资质符合停车服务要求
- [ ] 车位为**产权车位**或**允许转租的月租车位**；**人防车位不得盈利性出租**
- [ ] 业主发布前签署《车位出租授权》电子协议（建议加在备案流程）
- [ ] 车辆剐蹭、车内财物丢失的责任划分写入《用户协议》并明示
- [ ] 物业端权限隔离：审核/放行/分账能力仅 `isAdmin` 账号可用
- [ ] 收集车牌、手机号需在《隐私政策》中声明并取得授权（小程序需配置隐私协议）
- [ ] 资金流：若涉及代收代付，需明确开票与结算主体，避免「二清」风险

---

## 九、测试

```bash
# 云函数全链路回归（内存数据库，无需云环境）
node tests/cloud-test.js
```

覆盖：登录建档、角色权限、车位列表、下单并发锁、支付生成通行码、道闸核验（含提前入场拒绝）、
入场出场结算、物业审核、业主发布时段（含重叠校验）、经营看板分账。

---

## 十、已知限制 / 下一步

- [ ] 支付为演示模式，需按第六章接入微信支付
- [ ] 道闸为名单导出模式，L3 API 适配器待接
- [ ] 订单列表分页未做（当前 limit 50），上线前需补
- [ ] `publishWeekend` 以「本周六」计算，跨周场景需产品确认
- [ ] 缺少退款 / 申诉 / 评价体系
- [ ] 缺少订阅消息（下单成功、即将到期、超时提醒）——建议下一步优先做
- [ ] 多小区支持：当前 `communities` 取第一条，多小区需按用户 `communityId` 隔离
