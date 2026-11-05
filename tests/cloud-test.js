/**
 * 云函数回归测试（不依赖真实云开发环境）
 * ------------------------------------------------------------
 * 用一个极简的内存版 wx-server-sdk 模拟云数据库，验证下单/支付/道闸/结算/审核全链路。
 *
 * 运行： node tests/cloud-test.js
 */
const Module = require('module');
const path = require('path');
const path0 = require('path');
const fake = require(path0.join(__dirname, 'fakesdk.js'));
const orig = Module._load;
Module._load = function (req, parent, isMain) {
  if (req === 'wx-server-sdk') return fake;
  return orig.apply(this, arguments);
};

const ROOT = path0.join(__dirname, '..', 'cloudfunctions');
const load = n => require(path.join(ROOT, n, 'index.js'));
const login = load('login'), spot = load('spot'), slot = load('slot'), order = load('order'), access = load('access'), admin = load('admin');

const common = require(path.join(ROOT, 'order', 'common.js'));
const d0 = common.dateStr(0), d1 = common.dateStr(1), dM1 = common.dateStr(-1);

function seed() {
  fake.__seed('communities', [{ _id: 'C001', name: '阳光花园', totalSpots: 386, barrier: '捷顺 JSD-3B2', split: common.SPLIT }]);
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
    { _id: 'L1', spotId: 'S1', ownerOpenid: 'owner-openid', date: d1, from: '08:00', to: '20:00', status: 'available' },
    { _id: 'L2', spotId: 'S2', ownerOpenid: 'u2', date: d1, from: '09:00', to: '18:00', status: 'available' },
    { _id: 'L3', spotId: 'S2', ownerOpenid: 'u2', date: dM1, from: '08:00', to: '20:00', status: 'booked' },
    { _id: 'L0', spotId: 'S2', ownerOpenid: 'u2', date: d0, from: '00:00', to: '23:59', status: 'available' }
  ]);
  fake.__seed('orders', []);
  fake.__seed('access_logs', []);
}

let pass = 0, failn = 0;
function check(label, cond, extra) {
  if (cond) { console.log('  ✓ ' + label); pass++; }
  else { console.log('  ✗ ' + label + (extra ? '  -> ' + JSON.stringify(extra) : '')); failn++; }
}

(async () => {
  seed();
  console.log('\n[login]');
  let r = await login.main({ action: 'profile' });
  check('profile ok', r.code === 0 && r.data.user._openid === 'renter-openid', r);
  check('community loaded', r.data.community.name === '阳光花园');
  r = await login.main({ action: 'setRole', role: 'property' });
  check('普通用户不能切物业', r.code === 403, r);

  console.log('\n[spot list]');
  r = await spot.main({ action: 'list', date: d1 });
  check('明日列表 2 个', r.code === 0 && r.data.list.length === 2, r.data && r.data.list.length);
  check('视图字段完整', r.data.list[0].priceText && r.data.list[0].timeText && r.data.list[0].stateText);

  console.log('\n[order flow]');
  r = await order.main({ action: 'create', slotId: 'L1', renterName: '刘先生', plate: '沪E·6R88', phone: '13611112222' });
  check('下单成功', r.code === 0, r);
  const oid = r.data.order._id;
  check('金额 = 日封顶 60', r.data.order.baseAmount === 60, r.data.order.baseAmount);
  check('时段被锁定', fake.__store.slots.find(s => s._id === 'L1').status === 'locked');

  r = await order.main({ action: 'create', slotId: 'L1', renterName: '抢占者', plate: '沪X11111' });
  check('重复下单被拒', r.code !== 0, r);

  r = await order.main({ action: 'create', slotId: 'L2', renterName: '自己', plate: '沪A2K78' });
  check('（S2 非本人车位，可下单）', r.code === 0, r.msg);
  const oid2 = r.data.order._id;

  r = await order.main({ action: 'pay', orderId: oid });
  check('支付成功并生成通行码', r.code === 0 && /^\d{6}$/.test(r.data.order.code), r);
  check('时段变为 booked', fake.__store.slots.find(s => s._id === 'L1').status === 'booked');
  const code = r.data.order.code;

  r = await order.main({ action: 'list', scope: 'renter' });
  check('租客订单列表 2 条', r.code === 0 && r.data.list.length === 2, r.data && r.data.list.length);
  check('含通行码', r.data.list.some(o => o.code === code && o.showCode));

  console.log('\n[access 道闸]');
  fake.__setOpenid('admin-openid');
  r = await access.main({ action: 'whitelist' });
  check('物业可拉白名单（仅已支付）', r.code === 0 && r.data.list.length === 1, r);
  r = await access.main({ action: 'verify', plate: '沪E6R88' });
  check('明日时段的预约提前入场被拒', r.data.allow === false && /未到生效时间/.test(r.data.msg), r.data);

  fake.__setOpenid('renter-openid');
  const l0 = await order.main({ action: 'create', slotId: 'L0', renterName: '刘先生', plate: '沪G·1A23' });
  check('今日时段可下单', l0.code === 0, l0);
  await order.main({ action: 'pay', orderId: l0.data.order._id });
  fake.__setOpenid('admin-openid');
  r = await access.main({ action: 'verify', plate: '沪G1A23' });
  check('今日有效预约放行', r.data.allow === true && /有效预约/.test(r.data.msg), r.data);
  check('放行流水已记录', fake.__store.access_logs.some(l => l.type === 'in' && l.plate === '沪G1A23'));
  r = await access.main({ action: 'verify', plate: '沪Z99999' });
  check('未预约拒绝', r.data.allow === false, r);
  fake.__setOpenid('renter-openid');
  r = await access.main({ action: 'whitelist' });
  check('普通用户不能看白名单', r.code === 403, r);

  console.log('\n[入场结算]');
  r = await order.main({ action: 'checkin', orderId: oid });
  check('入场成功', r.code === 0, r);
  r = await order.main({ action: 'checkout', orderId: oid });
  check('出场结算', r.code === 0, r);
  check('订单已完成', fake.__store.orders.find(o => o._id === oid).status === 'finished');

  console.log('\n[物业审核]');
  fake.__setOpenid('admin-openid');
  r = await spot.main({ action: 'pending' });
  check('待审核 1 个', r.code === 0 && r.data.list.length === 1, r);
  r = await spot.main({ action: 'approve', spotId: 'S3' });
  check('审核通过', r.code === 0 && fake.__store.spots.find(s => s._id === 'S3').status === 'approved');
  r = await admin.main({ action: 'stats' });
  check('看板可读', r.code === 0 && r.data.totalSpots === 386, r.msg);

  console.log('\n[业主发布]');
  fake.__setOpenid('owner-openid');
  r = await slot.main({ action: 'publish', date: d1, from: '08:00', to: '20:00' });
  check('重叠时段被拒', r.code !== 0, r.msg);
  r = await slot.main({ action: 'publish', date: d1, from: '21:00', to: '23:00' });
  check('非重叠时段发布成功', r.code === 0, r.msg);
  r = await slot.main({ action: 'publishWeekend' });
  check('周末模板发布', r.code === 0, r.msg);
  r = await spot.main({ action: 'my' });
  check('我的车位带时段', r.code === 0 && r.data.spot._id === 'S1' && r.data.slots.length >= 2, r.msg);

  console.log('\n结果: ' + pass + ' 通过, ' + failn + ' 失败');
  process.exit(failn ? 1 : 0);
})().catch(e => { console.error('EXCEPTION', e); process.exit(1); });
