/**
 * 云函数回归测试（不依赖真实云开发环境）
 * ------------------------------------------------------------
 * 用一个极简的内存版 wx-server-sdk 模拟云数据库，验证：
 *   登录 / 角色权限 / 车位列表 / 并发锁单 / 支付通行码 / 道闸核验
 *   时区正确性 / 车牌索引（>100 单）/ 入场时间窗口 / 定时任务结算
 *   物业审核 / 业主发布时段 / 经营看板
 *
 * 运行： node tests/cloud-test.js
 */
const Module = require('module');
const path = require('path');
const fake = require(path.join(__dirname, 'fakesdk.js'));

const origLoad = Module._load;
Module._load = function (req) {
  if (req === 'wx-server-sdk') return fake;
  return origLoad.apply(this, arguments);
};

const ROOT = path.join(__dirname, '..', 'cloudfunctions');
const load = n => require(path.join(ROOT, n, 'index.js'));

const login = load('login');
const spot = load('spot');
const slot = load('slot');
const order = load('order');
const access = load('access');
const admin = load('admin');
const timer = load('timer');
const notify = load('notify');

const common = require(path.join(ROOT, 'order', 'common.js'));

const d0 = common.dateStr(0);
const d1 = common.dateStr(1);
const dM1 = common.dateStr(-1);
const dM2 = common.dateStr(-2);
const d2 = common.dateStr(2);

let pass = 0, failn = 0;
function check(label, cond, extra) {
  if (cond) { console.log('  ✓ ' + label); pass++; }
  else { console.log('  ✗ ' + label + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); failn++; }
}
function section(t) { console.log('\n[' + t + ']'); }

function seed() {
  fake.__seed('communities', [{
    _id: 'C001', name: '阳光花园', totalSpots: 386, barrier: '捷顺 JSD-3B2', split: common.SPLIT,
    notifyTemplates: {
      startSoon: { templateId: 'TMPL_START', fields: { spot: 'thing1', time: 'time2' } },
      endSoon: { templateId: 'TMPL_END', fields: { spot: 'thing1', time: 'time2' } },
      overdue: { templateId: 'TMPL_LATE', fields: { spot: 'thing1', amount: 'amount3' } }
    }
  }]);
  fake.__seed('users', [
    { _id: 'U1', _openid: 'owner-openid', nickName: '张伟', phone: '13866216621', role: 'owner' },
    { _id: 'U2', _openid: 'renter-openid', nickName: '刘先生', phone: '13611112222', role: 'renter' },
    { _id: 'U3', _openid: 'admin-openid', nickName: '物业小王', role: 'property', isAdmin: true }
  ]);
  fake.__seed('spots', [
    { _id: 'S1', _openid: 'owner-openid', ownerOpenid: 'owner-openid', building: '7栋', spotNo: 'B1-082', ownerName: '张伟', ownerPhone: '138****6621', plate: '沪A2K78', pricePerHour: 12, dayCap: 60, status: 'approved', certType: '产权车位' },
    { _id: 'S2', _openid: 'u2', ownerOpenid: 'u2', building: '3栋', spotNo: 'B2-115', ownerName: '李娜', ownerPhone: '139****3312', plate: '沪B7M02', pricePerHour: 10, dayCap: 50, status: 'approved', certType: '产权车位' },
    { _id: 'S3', _openid: 'u3', ownerOpenid: 'u3', building: '1栋', spotNo: 'A1-019', ownerName: '王强', ownerPhone: '137****9087', plate: '沪D3T55', pricePerHour: 15, dayCap: 70, status: 'pending', certType: '产权车位' }
  ]);
  fake.__seed('slots', [
    { _id: 'L0', spotId: 'S2', ownerOpenid: 'u2', date: d0, from: '00:00', to: '23:59', status: 'available' },
    { _id: 'L1', spotId: 'S1', ownerOpenid: 'owner-openid', date: d1, from: '08:00', to: '20:00', status: 'available' },
    { _id: 'L2', spotId: 'S2', ownerOpenid: 'u2', date: d1, from: '09:00', to: '18:00', status: 'available' },
    { _id: 'L3', spotId: 'S2', ownerOpenid: 'u2', date: dM1, from: '08:00', to: '20:00', status: 'booked' },
    { _id: 'L9', spotId: 'S1', ownerOpenid: 'owner-openid', date: d2, from: '08:00', to: '20:00', status: 'available' }
  ]);
  fake.__seed('orders', []);
  fake.__seed('access_logs', []);
}

(async () => {
  seed();

  /* ============ 时区 ============ */
  section('时区（东八区显式计算）');
  check('slotTs 解析为正确的 UTC 时刻',
    common.slotTs('2026-11-07', '08:00') === Date.UTC(2026, 10, 7, 0, 0),
    new Date(common.slotTs('2026-11-07', '08:00')).toISOString());
  check('ISO 输出为 2026-11-07T00:00:00Z',
    new Date(common.slotTs('2026-11-07', '08:00')).toISOString() === '2026-11-07T00:00:00.000Z');
  const expectToday = (() => {
    const t = new Date(Date.now() + 8 * 3600000);
    return t.getUTCFullYear() + '-' + common.pad(t.getUTCMonth() + 1) + '-' + common.pad(t.getUTCDate());
  })();
  check('dateStr(0) 等于北京时间今天', common.dateStr(0) === expectToday, { got: common.dateStr(0), want: expectToday });
  check('dateStr(1) 比 dateStr(0) 晚一天',
    common.slotTs(common.dateStr(1), '00:00') - common.slotTs(common.dateStr(0), '00:00') === 86400000);

  /* ============ 登录 ============ */
  section('登录与权限');
  let r = await login.main({ action: 'profile' });
  check('profile 建档', r.code === 0 && r.data.user._openid === 'renter-openid', r);
  check('小区配置可读', r.data.community.name === '阳光花园');
  fake.__setOpenid('renter-openid');
  r = await login.main({ action: 'setRole', role: 'property' });
  check('普通用户不能自行切换物业身份', r.code === 403, r);

  /* ============ 车位列表 ============ */
  section('车位列表');
  r = await spot.main({ action: 'list', date: d1 });
  check('明日列表 2 个', r.code === 0 && r.data.list.length === 2, r.data && r.data.list && r.data.list.length);
  check('视图字段完整', !!(r.data.list[0].priceText && r.data.list[0].timeText && r.data.list[0].stateText));

  /* ============ 下单 / 支付 ============ */
  section('下单与支付');
  r = await order.main({ action: 'create', slotId: 'L1', renterName: '刘先生', plate: '沪E·6R88', phone: '13611112222' });
  check('下单成功', r.code === 0, r);
  const oidTomorrow = r.data.order._id;
  check('金额 = 日封顶 60', r.data.order.baseAmount === 60, r.data.order.baseAmount);
  check('已写入归一化 plateKey', r.data.order.plateKey === '沪E6R88', r.data.order.plateKey);
  check('时段被锁定', fake.__store.slots.find(s => s._id === 'L1').status === 'locked');

  r = await order.main({ action: 'create', slotId: 'L1', renterName: '抢占者', plate: '沪X11111' });
  check('重复下单被拒（原子锁）', r.code !== 0, r);

  r = await order.main({ action: 'pay', orderId: oidTomorrow });
  check('支付成功并生成 6 位通行码', r.code === 0 && /^\d{6}$/.test(r.data.order.code), r);
  check('时段变为 booked', fake.__store.slots.find(s => s._id === 'L1').status === 'booked');

  /* ============ 道闸核验 ============ */
  section('道闸核验');
  fake.__setOpenid('admin-openid');
  r = await access.main({ action: 'verify', plate: '沪E6R88' });
  check('明日预约提前入场被拒（窗口校验生效）',
    r.data.allow === false && /未到生效时间/.test(r.data.msg), r.data);

  fake.__setOpenid('renter-openid');
  r = await order.main({ action: 'create', slotId: 'L0', renterName: '刘先生', plate: '沪G·1A23' });
  const oidToday = r.data.order._id;
  await order.main({ action: 'pay', orderId: oidToday });
  fake.__setOpenid('admin-openid');
  r = await access.main({ action: 'verify', plate: '沪G1A23' });
  check('今日有效预约放行', r.data.allow === true && /有效预约/.test(r.data.msg), r.data);
  check('放行流水已记录', fake.__store.access_logs.some(l => l.plate === '沪G1A23'));

  r = await access.main({ action: 'verify', plate: '沪Z99999' });
  check('未预约车辆拒绝放行', r.data.allow === false);
  fake.__setOpenid('renter-openid');
  r = await access.main({ action: 'whitelist' });
  check('非物业不能拉白名单', r.code === 403, r);

  /* ============ 车牌索引：超过 100 单仍能命中 ============ */
  section('车牌索引（>100 单场景）');
  for (let i = 0; i < 150; i++) {
    fake.__store.orders.push({
      _id: 'BULK' + i, orderNo: 'BULK' + i, slotId: 'LX' + i, spotId: 'S2',
      ownerOpenid: 'u2', renterOpenid: 'bulk', renterName: '批量', plate: '沪K' + (10000 + i),
      plateKey: '沪K' + (10000 + i), date: d0, from: '00:00', to: '23:59',
      baseAmount: 10, extraAmount: 0, status: 'paid', code: '000000',
      createdAt: Date.now(), paidAt: Date.now(), inAt: null, outAt: null
    });
  }
  fake.__setOpenid('admin-openid');
  r = await access.main({ action: 'verify', plate: '沪G1A23' });
  check('150 条干扰订单存在时，目标车牌仍能命中', r.data.allow === true, r.data.msg);
  r = await access.main({ action: 'verify', plate: '沪K10149' });
  check('批量订单中最后一条也能命中', r.data.allow === true, r.data.msg);

  /* ============ 入场时间窗口 ============ */
  section('入场时间窗口');
  fake.__setOpenid('renter-openid');
  r = await order.main({ action: 'checkin', orderId: oidTomorrow });
  check('租客提前入场被拒', r.code !== 0 && /未到入场时间/.test(r.msg), r);
  fake.__setOpenid('admin-openid');
  r = await order.main({ action: 'checkin', orderId: oidTomorrow });
  check('物业可人工放行（调试入口）', r.code === 0, r);

  /* ============ 出场结算 ============ */
  section('出场结算');
  fake.__setOpenid('renter-openid');
  r = await order.main({ action: 'checkin', orderId: oidToday });
  check('今日订单可入场', r.code === 0, r);
  r = await order.main({ action: 'checkout', orderId: oidToday });
  check('出场结算完成', r.code === 0, r);
  check('订单状态 finished', fake.__store.orders.find(o => o._id === oidToday).status === 'finished');

  /* ============ 定时任务：超时费累计与自动封账 ============ */
  section('定时任务（超时费）');
  const now = Date.now();
  fake.__store.orders.push({
    _id: 'OT1', orderNo: 'OT1', slotId: 'LO1', spotId: 'S2', ownerOpenid: 'u2',
    renterOpenid: 'u9', renterName: '超时客', plate: '沪T1111', plateKey: '沪T1111',
    date: d0, from: '00:00', to: '01:00', baseAmount: 50, extraAmount: 0,
    status: 'checked_in', code: '111111', createdAt: now - 86400000,
    paidAt: now - 86000000, inAt: now - 80000000, outAt: null
  });
  fake.__store.orders.push({
    _id: 'OT2', orderNo: 'OT2', slotId: 'LO2', spotId: 'S2', ownerOpenid: 'u2',
    renterOpenid: 'u10', renterName: '长期超时', plate: '沪T2222', plateKey: '沪T2222',
    date: dM2, from: '00:00', to: '01:00', baseAmount: 50, extraAmount: 0,
    status: 'checked_in', code: '222222', createdAt: now - 172800000,
    paidAt: now - 172000000, inAt: now - 171000000, outAt: null
  });
  r = await timer.main({});
  check('定时任务执行成功', r.code === 0, r);
  const ot1 = fake.__store.orders.find(o => o._id === 'OT1');
  check('超时费已累计落库', ot1.extraAmount > 0, ot1.extraAmount);
  check('超时费不超过 2 倍日封顶（100）', ot1.extraAmount <= 100, ot1.extraAmount);
  const ot2 = fake.__store.orders.find(o => o._id === 'OT2');
  check('超时 6 小时后自动封账', ot2.status === 'finished' && ot2.autoFinished === true, ot2.status);

  /* ============ 物业审核 ============ */
  section('物业审核');
  fake.__setOpenid('admin-openid');
  r = await spot.main({ action: 'pending' });
  check('待审核 1 个', r.code === 0 && r.data.list.length === 1, r);
  r = await spot.main({ action: 'approve', spotId: 'S3' });
  check('审核通过', r.code === 0 && fake.__store.spots.find(s => s._id === 'S3').status === 'approved');
  r = await admin.main({ action: 'stats' });
  check('经营看板可读', r.code === 0 && r.data.totalSpots === 386, r.msg);

  /* ============ 业主发布 ============ */
  section('业主发布时段');
  fake.__setOpenid('owner-openid');
  r = await slot.main({ action: 'publish', date: d1, from: '08:00', to: '20:00' });
  check('重叠时段被拒', r.code !== 0, r.msg);
  r = await slot.main({ action: 'publish', date: d1, from: '21:00', to: '23:00' });
  check('非重叠时段发布成功', r.code === 0, r.msg);
  r = await slot.main({ action: 'publishWeekend' });
  check('周末模板发布成功', r.code === 0, r.msg);
  if (r.code === 0) {
    // 周六已被上方手工发布的时段占用，故可能只生成周日；断言生成的日期都属于周末
    const allWeekend = r.data.list.every(function (x) {
      return ['周六', '周日'].indexOf(common.weekdayCn(x.date)) >= 0;
    });
    check('周末模板生成的日期都落在周六/周日（东八区）',
      allWeekend, r.data.list.map(function (x) { return x.date + ' ' + common.weekdayCn(x.date); }).join(','));
  }
  r = await spot.main({ action: 'my' });
  check('我的车位带时段', r.code === 0 && r.data.spot._id === 'S1' && r.data.slots.length >= 2, r.msg);

  /* ============ 取消与退款 ============ */
  section('取消与退款');
  // 纯函数：退款比例
  const farOrder = { status: 'paid', baseAmount: 100, date: d1, from: '08:00' };
  check('开始前 >2h 取消 → 全额退款', common.refundOf(farOrder) === 100, common.refundOf(farOrder));

  const soonMs = Date.now() + 60 * 60 * 1000;
  const cnSoon = new Date(soonMs + 8 * 3600000);
  const soonDate = cnSoon.getUTCFullYear() + '-' + common.pad(cnSoon.getUTCMonth() + 1) + '-' + common.pad(cnSoon.getUTCDate());
  const soonTime = common.pad(cnSoon.getUTCHours()) + ':' + common.pad(cnSoon.getUTCMinutes());
  const nearOrder = { status: 'paid', baseAmount: 100, date: soonDate, from: soonTime };
  check('开始前 <2h 取消 → 退 50%', common.refundOf(nearOrder) === 50, common.refundOf(nearOrder));

  // 已支付订单取消
  fake.__setOpenid('renter-openid');
  r = await order.main({ action: 'create', slotId: 'L2', renterName: '刘先生', plate: '沪H·7K77' });
  const oidCancel = r.data.order._id;
  await order.main({ action: 'pay', orderId: oidCancel });
  r = await order.main({ action: 'cancel', orderId: oidCancel });
  check('已支付订单可取消并退款', r.code === 0 && r.data.refund === 50, r);
  const cancelledOrder = fake.__store.orders.find(o => o._id === oidCancel);
  check('订单状态 refunded', cancelledOrder.status === 'refunded', cancelledOrder.status);
  check('车位释放回可租', fake.__store.slots.find(s => s._id === 'L2').status === 'available');
  check('记录退款金额与取消方', cancelledOrder.refundAmount === 50 && cancelledOrder.cancelBy === 'renter');

  // 业主取消
  fake.__setOpenid('renter-openid');
  r = await order.main({ action: 'create', slotId: 'L9', renterName: '刘先生', plate: '沪H·7K77' });
  const oidOwnerCancel = r.data.order._id;
  await order.main({ action: 'pay', orderId: oidOwnerCancel });
  fake.__setOpenid('owner-openid');
  r = await order.main({ action: 'ownerCancel', orderId: oidOwnerCancel });
  check('业主可收回车位并全额退款', r.code === 0 && r.data.refund === 60, r);
  check('记录业主补偿金额（30%）', fake.__store.orders.find(o => o._id === oidOwnerCancel).ownerPenalty === 18);
  check('收回后时段重新可租', fake.__store.slots.find(s => s._id === 'L9').status === 'available');

  // 已入场不可取消
  fake.__setOpenid('renter-openid');
  r = await order.main({ action: 'cancel', orderId: oidTomorrow });
  check('已入场/已开始订单不可自助取消', r.code !== 0, r.msg);

  /* ============ 订阅消息 ============ */
  section('订阅消息');
  fake.__setOpenid('admin-openid');
  r = await notify.main({ action: 'templates' });
  check('可读取模板配置', r.code === 0 && !!r.data.templates.startSoon, r.msg);
  const beforeSent = fake.__sent.length;
  r = await notify.main({ action: 'send', key: 'startSoon', toOpenid: 'renter-openid', data: { thing1: { value: 'B1-082' } } });
  check('发送订阅消息成功', r.code === 0 && r.data.sent === true, r);
  check('已调用 openapi.subscribeMessage.send', fake.__sent.length === beforeSent + 1);
  r = await notify.main({ action: 'send', key: 'notExist', toOpenid: 'x' });
  check('未配置模板时安静跳过', r.code === 0 && r.data.skipped === true, r);

  // 定时任务发送「即将入场」提醒
  const startMs = Date.now() + 20 * 60 * 1000;
  const cnS = new Date(startMs + 8 * 3600000);
  const sDate = cnS.getUTCFullYear() + '-' + common.pad(cnS.getUTCMonth() + 1) + '-' + common.pad(cnS.getUTCDate());
  const sFrom = common.pad(cnS.getUTCHours()) + ':' + common.pad(cnS.getUTCMinutes());
  const cnE = new Date(startMs + 2 * 3600 * 1000 + 8 * 3600000);
  const sTo = common.pad(cnE.getUTCHours()) + ':' + common.pad(cnE.getUTCMinutes());
  fake.__store.orders.push({
    _id: 'RM1', orderNo: 'RM1', slotId: 'LRM1', spotId: 'S2', ownerOpenid: 'u2',
    renterOpenid: 'renter-openid', renterName: '提醒测试', plate: '沪R1111', plateKey: '沪R1111',
    date: sDate, from: sFrom, to: sTo, baseAmount: 20, extraAmount: 0,
    status: 'paid', code: '333333', createdAt: Date.now(), paidAt: Date.now(), inAt: null, outAt: null
  });
  const beforeRemind = fake.__sent.length;
  r = await timer.main({});
  check('定时任务触发「即将入场」提醒', r.code === 0 && r.data.remindStart === 1, r.data);
  check('提醒消息已发送', fake.__sent.length === beforeRemind + 1 && fake.__sent[fake.__sent.length - 1].templateId === 'TMPL_START');
  check('订单标记已提醒（防重复发送）', fake.__store.orders.find(o => o._id === 'RM1').remindedStart > 0);
  const sentCount = fake.__sent.length;
  await timer.main({});
  check('重复执行不会重复提醒', fake.__sent.length === sentCount);

  console.log('\n结果: ' + pass + ' 通过, ' + failn + ' 失败');
  process.exit(failn ? 1 : 0);
})().catch(e => { console.error('EXCEPTION', e); process.exit(1); });
