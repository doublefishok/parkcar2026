const cloud = require('wx-server-sdk');
const common = require('./common.js');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const PAY_TIMEOUT = 15 * 60 * 1000; // 未支付订单 15 分钟自动释放

async function docOrNull(coll, id) {
  try { return (await db.collection(coll).doc(id).get()).data; } catch (e) { return null; }
}

async function assertAdmin(OPENID) {
  const r = await db.collection('users').where({ _openid: OPENID }).limit(1).get();
  const u = r.data[0];
  return !!(u && (u.role === 'property' || u.isAdmin));
}

/** 回收超时未支付订单，释放车位 */
async function cleanupUnpaid() {
  const cutoff = Date.now() - PAY_TIMEOUT;
  const r = await db.collection('orders')
    .where({ status: 'unpaid', createdAt: _.lt(cutoff) }).limit(50).get();
  for (const o of r.data) {
    await db.collection('orders').doc(o._id).update({ data: { status: 'cancelled' } });
    await db.collection('slots').where({ _id: o.slotId, status: 'locked' }).update({ data: { status: 'available' } });
  }
}

async function buildList(orders, split) {
  if (!orders.length) return [];
  const slotIds = Array.from(new Set(orders.map(function (o) { return o.slotId; })));
  const spotIds = Array.from(new Set(orders.map(function (o) { return o.spotId; })));

  const slots = (await db.collection('slots').where({ _id: _.in(slotIds) }).limit(100).get()).data;
  const spots = (await db.collection('spots').where({ _id: _.in(spotIds) }).limit(100).get()).data;

  const smap = {}; slots.forEach(function (s) { smap[s._id] = s; });
  const pmap = {}; spots.forEach(function (p) { pmap[p._id] = p; });

  return orders.map(function (o) {
    const slot = smap[o.slotId] || { date: o.date, from: o.from, to: o.to };
    const spot = pmap[o.spotId] || { spotNo: '—', building: '—' };
    return common.buildOrderView(o, slot, spot, split);
  });
}

/**
 * 订单
 * action: create | pay | cancel | detail | list | checkin | checkout
 */
exports.main = async function (event) {
  const OPENID = cloud.getWXContext().OPENID;
  const action = event.action;

  try {
    /* ---------- 下单（原子锁定时段） ---------- */
    if (action === 'create') {
      await cleanupUnpaid();

      const slot = await docOrNull('slots', event.slotId);
      if (!slot) return common.fail('时段不存在', 404);
      if (slot.status !== 'available') return common.fail('手慢了，该时段已被预约');
      if (!event.renterName) return common.fail('请填写您的称呼');
      if (!common.isValidPlate(event.plate)) return common.fail('车牌号格式不正确');
      if (Date.now() > common.slotTs(slot.date, slot.to)) return common.fail('该时段已结束');

      const spot = await docOrNull('spots', slot.spotId);
      if (!spot) return common.fail('车位不存在', 404);
      if (spot.ownerOpenid === OPENID) return common.fail('不能预约自己的车位');

      // 条件更新实现原子锁定：只有 status 仍为 available 才更新成功
      const lock = await db.collection('slots')
        .where({ _id: slot._id, status: 'available' })
        .update({ data: { status: 'locked' } });
      if (lock.stats.updated === 0) return common.fail('手慢了，该时段已被预约');

      const order = {
        _openid: OPENID,
        orderNo: common.genOrderNo(),
        slotId: slot._id,
        spotId: spot._id,
        ownerOpenid: spot.ownerOpenid,
        renterOpenid: OPENID,
        renterName: String(event.renterName).slice(0, 20),
        renterPhone: String(event.phone || '').slice(0, 20),
        plate: common.normPlate(event.plate),
        date: slot.date,
        from: slot.from,
        to: slot.to,
        baseAmount: common.calcPrice(spot, slot),
        extraAmount: 0,
        status: 'unpaid',
        code: '',
        payId: '',
        createdAt: Date.now(),
        paidAt: 0,
        inAt: null,
        outAt: null
      };
      const addRes = await db.collection('orders').add({ data: order });
      return common.ok({ order: Object.assign({ _id: addRes._id }, order), spot: spot });
    }

    /* ---------- 支付 ----------
     * 当前为演示支付。生产环境请改为：
     *   1) 用 cloud.cloudPay.unifiedOrder 下单，返回 payment 参数
     *   2) 小程序端 wx.requestPayment 支付
     *   3) 新增云函数 pay-notify 接收支付回调，回调内把订单置为 paid
     * 详见 README「接入真实微信支付」。
     */
    if (action === 'pay') {
      const o = await docOrNull('orders', event.orderId);
      if (!o) return common.fail('订单不存在', 404);
      if (o.renterOpenid !== OPENID) return common.fail('无权操作', 403);
      if (o.status !== 'unpaid') return common.fail('订单状态不正确');

      const code = common.genCode();
      const payId = 'PAY' + Date.now();
      await db.collection('orders').doc(o._id).update({
        data: { status: 'paid', code: code, paidAt: Date.now(), payId: payId }
      });
      await db.collection('slots').doc(o.slotId).update({ data: { status: 'booked' } });

      return common.ok({ order: Object.assign({}, o, { status: 'paid', code: code, payId: payId }) });
    }

    if (action === 'cancel') {
      const o = await docOrNull('orders', event.orderId);
      if (!o) return common.fail('订单不存在', 404);
      if (o.renterOpenid !== OPENID) return common.fail('无权操作', 403);
      if (o.status !== 'unpaid') return common.fail('已支付订单请走退款流程');

      await db.collection('orders').doc(o._id).update({ data: { status: 'cancelled' } });
      await db.collection('slots').where({ _id: o.slotId, status: 'locked' }).update({ data: { status: 'available' } });
      return common.ok({});
    }

    if (action === 'detail') {
      const o = await docOrNull('orders', event.orderId);
      if (!o) return common.fail('订单不存在', 404);
      const slot = await docOrNull('slots', o.slotId) || { date: o.date, from: o.from, to: o.to };
      const spot = await docOrNull('spots', o.spotId) || { spotNo: '—', building: '—' };
      return common.ok({ order: common.buildOrderView(o, slot, spot, common.SPLIT), spot: spot });
    }

    if (action === 'list') {
      await cleanupUnpaid();
      const scope = event.scope === 'owner' ? 'owner' : 'renter';
      const where = scope === 'owner'
        ? { ownerOpenid: OPENID, status: _.neq('cancelled') }
        : { renterOpenid: OPENID, status: _.neq('cancelled') };

      const r = await db.collection('orders').where(where).orderBy('createdAt', 'desc').limit(50).get();
      const list = await buildList(r.data, common.SPLIT);
      return common.ok({ list: list });
    }

    /* ---------- 入场核销 ----------
     * 生产环境由道闸车牌识别触发；此处保留人工/调试入口
     */
    if (action === 'checkin') {
      const o = await docOrNull('orders', event.orderId);
      if (!o) return common.fail('订单不存在', 404);
      const isAdmin = await assertAdmin(OPENID);
      if (o.renterOpenid !== OPENID && !isAdmin) return common.fail('无权操作', 403);
      if (o.status !== 'paid') return common.fail('订单状态不正确');

      await db.collection('orders').doc(o._id).update({ data: { status: 'checked_in', inAt: Date.now() } });
      await db.collection('access_logs').add({
        data: { orderId: o._id, plate: o.plate, type: 'in', gate: '南门入口', source: 'manual', at: Date.now() }
      });
      return common.ok({ order: Object.assign({}, o, { status: 'checked_in' }) });
    }

    /* ---------- 出场结算 ---------- */
    if (action === 'checkout') {
      const o = await docOrNull('orders', event.orderId);
      if (!o) return common.fail('订单不存在', 404);
      const isAdmin = await assertAdmin(OPENID);
      if (o.renterOpenid !== OPENID && !isAdmin) return common.fail('无权操作', 403);
      if (o.status !== 'checked_in') return common.fail('订单状态不正确');

      const spot = await docOrNull('spots', o.spotId) || { pricePerHour: 10 };
      const extra = common.extraFeeOf(o, spot);
      const now = Date.now();

      await db.collection('orders').doc(o._id).update({
        data: { status: 'finished', outAt: now, finishedAt: now, extraAmount: extra }
      });
      await db.collection('access_logs').add({
        data: { orderId: o._id, plate: o.plate, type: 'out', gate: '南门出口', source: 'manual', at: now }
      });

      return common.ok({ order: Object.assign({}, o, { status: 'finished', extraAmount: extra }), extra: extra });
    }

    return common.fail('未知操作：' + action, 404);
  } catch (e) {
    console.error('[order]', action, e);
    return common.fail(e.message || '服务异常', 500);
  }
};
