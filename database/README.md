# 云数据库初始化

所有集合都建议设置为 **「仅管理端可读写」**（权限级别 4：仅管理端可读写），
前端一律通过云函数访问，不直连数据库。

## 一、创建集合

在「云开发 → 数据库」中新建以下 6 个集合：

| 集合 | 说明 |
|---|---|
| `communities` | 小区配置（分成比例、道闸品牌） |
| `users` | 用户（业主 / 租客 / 物业） |
| `spots` | 车位（含审核状态） |
| `slots` | 空闲时段 |
| `orders` | 订单 |
| `access_logs` | 道闸通行流水 |

## 二、导入种子数据

### 1. communities（必须，只有一条）

在 `communities` 集合点「添加记录」，导入以下 JSON：

```json
{
  "name": "阳光花园",
  "address": "浦东新区阳光路 128 号",
  "households": 468,
  "totalSpots": 386,
  "barrier": "捷顺 JSD-3B2",
  "barrierMode": "L2",
  "split": { "platform": 0.1, "property": 0.15, "owner": 0.75 }
}
```

> `split` 三项之和必须为 1。`barrierMode` 取 `L1` / `L2` / `L3`，仅用于前端展示。

### 2. 演示车位（可选，用于内部测试）

`spots` 集合导入（注意把 `ownerOpenid` 换成真实用户在小程序里登录后生成的 openid）：

```json
{"ownerOpenid":"REPLACE_WITH_OPENID","building":"7栋","spotNo":"B1-082","plate":"沪A2K78","pricePerHour":12,"dayCap":60,"certType":"产权车位","status":"approved","verifiedAt":"2026-11-01"}
{"ownerOpenid":"REPLACE_WITH_OPENID","building":"3栋","spotNo":"B2-115","plate":"沪B7M02","pricePerHour":10,"dayCap":50,"certType":"产权车位","status":"approved","verifiedAt":"2026-11-01"}
```

`slots` 集合导入（`date` 换成未来日期）：

```json
{"spotId":"REPLACE_WITH_SPOT_ID","ownerOpenid":"REPLACE_WITH_OPENID","date":"2026-11-07","from":"08:00","to":"20:00","status":"available"}
```

> `spotId` 是导入 spots 后自动生成的 `_id`。

## 三、设置物业管理员

物业端（审核、放行、看板）需要管理员权限，否则 `setRole('property')` 会返回 403。

1. 用微信开发者工具登录小程序，进「我的」页（会自动在 `users` 集合建档）
2. 在云开发控制台打开 `users` 集合，找到自己的记录
3. 添加字段：`isAdmin` = `true`（类型 Boolean）
4. 重新进入「我的」页，切换到「物业」身份

## 四、建索引（上线前务必执行）

在「数据库 → 索引管理」中为以下字段建索引：

| 集合 | 索引字段 | 用途 |
|---|---|---|
| `orders` | `renterOpenid`(升) + `createdAt`(降) | 租客订单列表 |
| `orders` | `ownerOpenid`(升) + `createdAt`(降) | 业主收益列表 |
| `orders` | `status`(升) | 白名单 / 在场车辆查询 |
| `orders` | **`plateKey`(升) + `status`(升)** | 道闸核验（必建，否则大数据量会误拒放行） |
| `orders` | `date`(升) + `status`(升) | 经营看板按日聚合 |
| `slots` | `date`(升) + `status`(升) | 首页按日期查车位 |
| `slots` | `spotId`(升) | 我的时段 / 重叠校验 |
| `spots` | `ownerOpenid`(升) | 我的车位 |
| `spots` | `status`(升) | 待审核列表 |
| `access_logs` | `at`(降) | 通行流水 |

## 五、定时任务（已实现，需确认触发器生效）

`cloudfunctions/timer` 已内置定时任务，配置在同目录 `config.json`：

```json
{ "triggers": [{ "name": "settleTimer", "type": "timer", "config": "0 */10 * * * * *" }] }
```

部署该云函数后，请在「云开发 → 云函数 → timer → 触发器」确认存在 `settleTimer`（每 10 分钟）。
它负责：

1. 释放超时未支付订单（15 分钟），把车位放回可租
2. 在场且已超时的订单：按当前时间累计超时费并落库
3. 超时超过 6 小时仍未出场：自动封账，避免无限累计

> **注意**：微信云函数的 cron 表达式是 **7 位**（秒 分 时 日 月 周 年）。
> `0 */10 * * * * *` = 每 10 分钟执行一次。

后续建议补充：
- **订阅消息**：预约即将开始 / 即将到期提醒

## 六、数据备份

云开发控制台支持导出集合为 JSON。上线前务必配置**每日自动备份**，
并把备份文件下载到本地留档（云开发备份默认保留 7 天）。
