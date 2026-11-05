/**
 * Mock 数据层（USE_MOCK = true 时使用）
 * ------------------------------------------------------------
 * 完整模拟云函数行为，数据存于本地 Storage，无需开通云开发即可跑通全流程。
 * 正式上线时将 config.USE_MOCK 改为 false，逻辑与 cloudfunctions/ 保持一致。
 */
const util = require('./util.js');

const STORE_KEY = 'linli_mock_db_v2';
const DB_VERSION = 2;
const SPLIT = { platform: 0.10, property: 0.15, owner: 0.75 };

let DB = null;

/* ---------------- 数据 ---------------- */
function seed() {
  const d0 = util.dateStr(0), d1 = util.dateStr(1), d2 = util.dateStr(2), dM1 = util.dateStr(-1);

  const spots = [
    { _id: 'S1', building: '7栋', spotNo: 'B1-082', ownerName: '张伟', ownerPhone: '13866216621', ownerOpenid: 'me', plate: '沪A·2K78', pricePerHour: 12, dayCap: 60, status: 'approved', certType: '产权车位', verifiedAt: dM1 },
    { _id: 'S2', building: '3栋', spotNo: 'B2-115', ownerName: '李娜', ownerPhone: '13933123312', ownerOpenid: 'u2', plate: '沪B·7M02', pricePerHour: 10, dayCap: 50, status: 'approved', certType: '产权车位', verifiedAt: dM1 },
    { _id: 'S4', building: '5栋', spotNo: 'B1-201', ownerName: '赵敏', ownerPhone: '13577887788', ownerOpenid: 'u4', plate: '沪C·9Q31', pricePerHour: 8, dayCap: 40, status: 'approved', certType: '月租车位', verifiedAt: dM1 },
    { _id: 'S3', building: '1栋', spotNo: 'A1-019', ownerName: '王强', ownerPhone: '13790879087', ownerOpenid: 'u3', plate: '沪D·3T55', pricePerHour: 15, dayCap: 70, status: 'pending', certType: '产权车位', verifiedAt: '' }
  ];

  const slots = [
    { _id: 'L0', spotId: 'S2', ownerOpenid: 'u2', date: d0, from: '00:00', to: '23:59', status: 'booked' },
    { _id: 'L1', spotId: 'S1', ownerOpenid: 'me', date: d1, from: '08:00', to: '20:00', status: 'booked' },
    { _id: 'L2', spotId: 'S2', ownerOpenid: 'u2', date: d1, from: '09:00', to: '18:00', status: 'available' },
    { _id: 'L3', spotId: 'S4', ownerOpenid: 'u4', date: d1, from: '08:00', to: '22:00', status: 'available' },
    { _id: 'L4', spotId: 'S1', ownerOpenid: 'me', date: d2, from: '08:00', to: '20:00', status: 'available' },
    { _id: 'L5', spotId: 'S2', ownerOpenid: 'u2', date: d2, from: '10:00', to: '21:00', status: 'available' },
    { _id: 'L6', spotId: 'S4', ownerOpenid: 'u4', date: d2, from: '08:00', to: '18:00', status: 'available' },
    { _id: 'L7', spotId: 'S1', ownerOpenid: 'me', date: dM1, from: '08:00', to: '20:00', status: 'booked' }
  ];

  const orders = [
    {
      _id: 'O1', orderNo: 'LL202611050001', slotId: 'L0', spotId: 'S2', ownerOpenid: 'u2', renterOpenid: 'me',
      renterName: '张伟', renterPhone: '13866216621', plate: '沪A·2K78', date: d0, from: '00:00', to: '23:59',
      baseAmount: 50, extraAmount: 0, status: 'paid', code: '4821', payId: 'MOCKPAY001',
      createdAt: Date.now() - 3600000, paidAt: Date.now() - 3500000, inAt: null, outAt: null
    },
    {
      _id: 'O2', orderNo: 'LL202611050002', slotId: 'L1', spotId: 'S1', ownerOpenid: 'me', renterOpenid: 'u5',
      renterName: '刘先生', renterPhone: '13611112222', plate: '沪E·6R88', date: d1, from: '08:00', to: '20:00',
      baseAmount: 60, extraAmount: 0, status: 'paid', code: '7350', payId: 'MOCKPAY002',
      createdAt: Date.now() - 7200000, paidAt: Date.now() - 7100000, inAt: null, outAt: null
    },
    {
      _id: 'O3', orderNo: 'LL202611040003', slotId: 'L7', spotId: 'S1', ownerOpenid: 'me', renterOpenid: 'u6',
      renterName: '周先生', renterPhone: '13733334444', plate: '沪F·2N19', date: dM1, from: '08:00', to: '20:00',
      baseAmount: 60, extraAmount: 0, status: 'finished', code: '1093', payId: 'MOCKPAY003',
      createdAt: Date.now() - 90000000, paidAt: Date.now() - 89900000, inAt: Date.now() - 89000000, outAt: Date.now() - 82000000, finishedAt: Date.now() - 82000000
    }
  ];

  // 归一化车牌索引，与云端 plateKey 字段保持一致
  orders.forEach(function (o) { o.plateKey = util.normPlate(o.plate); });

  return {
    version: DB_VERSION,
    community: {
      _id: 'C001',
      name: '阳光花园',
      address: '浦东新区阳光路 128 号',
      households: 468,
      totalSpots: 386,
      barrier: '捷顺 JSD-3B2',
      barrierMode: 'L2',
      split: SPLIT
    },
    user: { _id: 'U1', openid: 'me', nickName: '张伟', phone: '13866216621', role: 'renter', building: '7栋' },
    spots: spots,
    slots: slots,
    orders: orders,
    logs: [],
    seq: 100
  };
}

function loadDB() {
  if (DB) return DB;
  try {
    const raw = wx.getStorageSync(STORE_KEY);
    if (raw && raw.version === DB_VERSION) {
      DB = raw;
      return DB;
    }
  } catch (e) { /* ignore */ }
  DB = seed();
  persist();
  return DB;
}

function persist() {
  try { wx.setStorageSync(STORE_KEY, DB); } catch (e) { /* ignore */ }
}

function resetDB() {
  DB = seed();
  persist();
}

/* ---------------- 查询助手 ---------------- */
function spotOf(id) { return loadDB().spots.filter(function (s) { return s._id === id; })[0]; }
function slotOf(id) { return loadDB().slots.filter(function (s) { return s._id === id; })[0]; }
function orderOf(id) { return loadDB().orders.filter(function (o) { return o._id === id; })[0]; }
function nextId(prefix) { const db = loadDB(); db.seq += 1; return prefix + db.seq; }
function nextOrderNo() {
  const d = new Date();
  const tail = String(Math.floor(Math.random() * 9000) + 1000);
  return 'LL' + d.getFullYear() + util.pad(d.getMonth() + 1) + util.pad(d.getDate()) + tail;
}

/* ---------------- 业务 ---------------- */
const routes = {

  /* ===== 登录 / 用户 ===== */
  'login/profile': function () {
    const db = loadDB();
    return { code: 0, data: { user: db.user, community: db.community } };
  },

  'user/setRole': function (p) {
    const db = loadDB();
    if (['renter', 'owner', 'property'].indexOf(p.role) < 0) return { code: 400, msg: '角色不合法' };
    db.user.role = p.role;
    persist();
    return { code: 0, data: { user: db.user } };
  },

  'user/reset': function () {
    resetDB();
    return { code: 0, data: {} };
  },

  /* ===== 车位（共享车位） ===== */
  'spot/list': function (p) {
    const db = loadDB();
    const date = p.date || util.dateStr(1);
    const list = db.slots
      .filter(function (sl) {
        if (sl.date !== date) return false;
        const sp = spotOf(sl.spotId);
        return sp && sp.status === 'approved';
      })
      .map(function (sl) { return util.buildSlotView(sl, spotOf(sl.spotId)); })
      .sort(function (a, b) { return util.hmToMin(a.from) - util.hmToMin(b.from); });
    return { code: 0, data: { list: list, date: date } };
  },

  'spot/detail': function (p) {
    const sl = slotOf(p.slotId);
    if (!sl) return { code: 404, msg: '时段不存在' };
    const sp = spotOf(sl.spotId);
    const db = loadDB();
    return {
      code: 0,
      data: {
        slot: util.buildSlotView(sl, sp),
        spot: sp,
        community: db.community
      }
    };
  },

  'spot/my': function () {
    const db = loadDB();
    const sp = db.spots.filter(function (s) { return s.ownerOpenid === db.user.openid; })[0];
    if (!sp) return { code: 0, data: { spot: null, slots: [] } };
    const slots = db.slots
      .filter(function (s) { return s.spotId === sp._id; })
      .map(function (s) { return util.buildSlotView(s, sp); })
      .sort(function (a, b) { return a.date === b.date ? util.hmToMin(a.from) - util.hmToMin(b.from) : (a.date > b.date ? 1 : -1); });
    return { code: 0, data: { spot: sp, slots: slots } };
  },

  'spot/apply': function (p) {
    const db = loadDB();
    if (!p.building || !p.spotNo) return { code: 400, msg: '请填写楼栋与车位号' };
    if (!util.isValidPlate(p.plate)) return { code: 400, msg: '车牌号格式不正确' };
    const exists = db.spots.filter(function (s) { return s.ownerOpenid === db.user.openid; });
    if (exists.length) return { code: 400, msg: '您已有备案车位' };
    const sp = {
      _id: nextId('S'),
      building: p.building,
      spotNo: p.spotNo,
      ownerName: db.user.nickName,
      ownerPhone: db.user.phone,
      ownerOpenid: db.user.openid,
      plate: p.plate,
      pricePerHour: Number(p.pricePerHour) || 10,
      dayCap: Number(p.dayCap) || 50,
      status: 'pending',
      certType: p.certType || '产权车位',
      verifiedAt: ''
    };
    db.spots.push(sp);
    persist();
    return { code: 0, data: { spot: sp } };
  },

  'spot/update': function (p) {
    const sp = spotOf(p.spotId);
    if (!sp) return { code: 404, msg: '车位不存在' };
    if (p.pricePerHour) sp.pricePerHour = Number(p.pricePerHour);
    if (p.dayCap) sp.dayCap = Number(p.dayCap);
    persist();
    return { code: 0, data: { spot: sp } };
  },

  'spot/pending': function () {
    const db = loadDB();
    const list = db.spots.filter(function (s) { return s.status === 'pending'; });
    return { code: 0, data: { list: list } };
  },

  'spot/approve': function (p) {
    const sp = spotOf(p.spotId);
    if (!sp) return { code: 404, msg: '车位不存在' };
    sp.status = 'approved';
    sp.verifiedAt = util.dateStr(0);
    persist();
    return { code: 0, data: { spot: sp } };
  },

  'spot/reject': function (p) {
    const db = loadDB();
    const sp = spotOf(p.spotId);
    if (!sp) return { code: 404, msg: '车位不存在' };
    sp.status = 'rejected';
    db.slots = db.slots.filter(function (s) { return s.spotId !== sp._id; });
    persist();
    return { code: 0, data: {} };
  },

  /* ===== 空闲时段 ===== */
  'slot/publish': function (p) {
    const db = loadDB();
    const sp = db.spots.filter(function (s) { return s.ownerOpenid === db.user.openid; })[0];
    if (!sp) return { code: 400, msg: '请先完成车位备案' };
    if (sp.status !== 'approved') return { code: 400, msg: '车位尚未通过物业审核' };
    if (!p.date || !p.from || !p.to) return { code: 400, msg: '请选择完整时段' };
    if (util.hmToMin(p.to) <= util.hmToMin(p.from)) return { code: 400, msg: '结束时间需晚于开始时间' };

    // 重叠校验
    const clash = db.slots.filter(function (s) {
      return s.spotId === sp._id && s.date === p.date && s.status !== 'cancelled' &&
        util.hmToMin(p.from) < util.hmToMin(s.to) && util.hmToMin(p.to) > util.hmToMin(s.from);
    });
    if (clash.length) return { code: 400, msg: '该时段与已发布时段重叠' };

    const slot = {
      _id: nextId('L'), spotId: sp._id, ownerOpenid: sp.ownerOpenid,
      date: p.date, from: p.from, to: p.to, status: 'available'
    };
    db.slots.push(slot);
    persist();
    return { code: 0, data: { slot: util.buildSlotView(slot, sp) } };
  },

  'slot/publishWeekend': function () {
    const db = loadDB();
    const sp = db.spots.filter(function (s) { return s.ownerOpenid === db.user.openid; })[0];
    if (!sp) return { code: 400, msg: '请先完成车位备案' };
    if (sp.status !== 'approved') return { code: 400, msg: '车位尚未通过物业审核' };

    const now = new Date();
    const delta = (6 - now.getDay() + 7) % 7 || 7;
    const sat = new Date(); sat.setDate(sat.getDate() + delta);
    const sun = new Date(sat); sun.setDate(sun.getDate() + 1);
    const fmt = function (d) { return d.getFullYear() + '-' + util.pad(d.getMonth() + 1) + '-' + util.pad(d.getDate()); };

    const created = [];
    [fmt(sat), fmt(sun)].forEach(function (date) {
      const clash = db.slots.filter(function (s) {
        return s.spotId === sp._id && s.date === date && s.status !== 'cancelled' &&
          util.hmToMin('08:00') < util.hmToMin(s.to) && util.hmToMin('20:00') > util.hmToMin(s.from);
      });
      if (clash.length) return;
      const slot = { _id: nextId('L'), spotId: sp._id, ownerOpenid: sp.ownerOpenid, date: date, from: '08:00', to: '20:00', status: 'available' };
      db.slots.push(slot);
      created.push(util.buildSlotView(slot, sp));
    });
    persist();
    if (!created.length) return { code: 400, msg: '本周末时段已发布过' };
    return { code: 0, data: { list: created } };
  },

  'slot/unpublish': function (p) {
    const db = loadDB();
    const sl = slotOf(p.slotId);
    if (!sl) return { code: 404, msg: '时段不存在' };
    if (sl.status !== 'available') return { code: 400, msg: '该时段已被预约，无法下架' };
    sl.status = 'cancelled';
    persist();
    return { code: 0, data: {} };
  },

  /* ===== 订单 ===== */
  'order/create': function (p) {
    const db = loadDB();
    const sl = slotOf(p.slotId);
    if (!sl) return { code: 404, msg: '时段不存在' };
    if (sl.status !== 'available') return { code: 400, msg: '手慢了，该时段已被预约' };
    if (!p.renterName) return { code: 400, msg: '请填写您的称呼' };
    if (!util.isValidPlate(p.plate)) return { code: 400, msg: '车牌号格式不正确' };
    if (Date.now() > util.slotTs(sl.date, sl.to)) return { code: 400, msg: '该时段已结束' };

    const sp = spotOf(sl.spotId);
    const base = util.calcPrice(sp, sl);

    const order = {
      _id: nextId('O'),
      orderNo: nextOrderNo(),
      slotId: sl._id,
      spotId: sp._id,
      ownerOpenid: sp.ownerOpenid,
      renterOpenid: db.user.openid,
      renterName: p.renterName,
      renterPhone: p.phone || '',
      plate: util.normPlate(p.plate),
      plateKey: util.normPlate(p.plate),
      date: sl.date,
      from: sl.from,
      to: sl.to,
      baseAmount: base,
      extraAmount: 0,
      status: 'unpaid',
      code: '',
      payId: '',
      createdAt: Date.now(),
      paidAt: 0,
      inAt: null,
      outAt: null
    };
    sl.status = 'locked';
    db.orders.push(order);
    persist();
    return { code: 0, data: { order: order, spot: sp } };
  },

  'order/pay': function (p) {
    const db = loadDB();
    const o = orderOf(p.orderId);
    if (!o) return { code: 404, msg: '订单不存在' };
    if (o.status !== 'unpaid') return { code: 400, msg: '订单状态不正确' };
    o.status = 'paid';
    o.code = util.genCode();
    o.paidAt = Date.now();
    o.payId = 'MOCKPAY' + Date.now();
    const sl = slotOf(o.slotId);
    if (sl) sl.status = 'booked';
    persist();
    return { code: 0, data: { order: o } };
  },

  'order/cancel': function (p) {
    const db = loadDB();
    const o = orderOf(p.orderId);
    if (!o) return { code: 404, msg: '订单不存在' };

    if (o.status === 'unpaid') {
      o.status = 'cancelled';
      o.cancelledAt = Date.now();
      o.cancelBy = 'renter';
      const sl = slotOf(o.slotId);
      if (sl && sl.status === 'locked') sl.status = 'available';
      persist();
      return { code: 0, data: { refund: 0, status: 'cancelled' } };
    }

    if (o.status !== 'paid') return { code: 400, msg: '当前状态不支持取消' };
    if (Date.now() >= util.slotTs(o.date, o.from)) {
      return { code: 400, msg: '已到开始时间，无法自助取消，请联系物业处理' };
    }

    const refund = util.refundOf(o);
    o.status = 'refunded';
    o.refundAmount = refund;
    o.refundedAt = Date.now();
    o.cancelledAt = Date.now();
    o.cancelBy = 'renter';
    const sl = slotOf(o.slotId);
    if (sl && sl.status === 'booked') sl.status = 'available';
    persist();
    return { code: 0, data: { refund: refund, status: 'refunded' } };
  },

  'order/ownerCancel': function (p) {
    const db = loadDB();
    const o = orderOf(p.orderId);
    if (!o) return { code: 404, msg: '订单不存在' };
    if (o.ownerOpenid !== db.user.openid) return { code: 403, msg: '无权操作' };
    if (o.status !== 'paid') return { code: 400, msg: '仅可取消「待入场」的订单' };

    const refund = o.baseAmount || 0;
    const penalty = Math.round(refund * util.OWNER_CANCEL_PENALTY_RATIO);
    o.status = 'refunded';
    o.refundAmount = refund;
    o.refundedAt = Date.now();
    o.cancelledAt = Date.now();
    o.cancelBy = 'owner';
    o.ownerPenalty = penalty;
    const sl = slotOf(o.slotId);
    if (sl && sl.status === 'booked') sl.status = 'available';
    persist();
    return { code: 0, data: { refund: refund, penalty: penalty } };
  },

  'order/detail': function (p) {
    const o = orderOf(p.orderId);
    if (!o) return { code: 404, msg: '订单不存在' };
    const sl = slotOf(o.slotId);
    const sp = spotOf(o.spotId);
    const db = loadDB();
    return { code: 0, data: { order: util.buildOrderView(o, sl, sp, db.community.split), spot: sp } };
  },

  'order/list': function (p) {
    const db = loadDB();
    const scope = p.scope || 'renter';
    let list = db.orders.filter(function (o) {
      if (o.status === 'cancelled') return false;
      return scope === 'owner' ? o.ownerOpenid === db.user.openid : o.renterOpenid === db.user.openid;
    });
    list = list.map(function (o) {
      const sl = slotOf(o.slotId) || { date: o.date, from: o.from, to: o.to };
      const sp = spotOf(o.spotId) || { spotNo: '—', building: '—' };
      return util.buildOrderView(o, sl, sp, db.community.split);
    }).sort(function (a, b) { return b.id > a.id ? 1 : -1; });
    return { code: 0, data: { list: list } };
  },

  'order/checkin': function (p) {
    const db = loadDB();
    const o = orderOf(p.orderId);
    if (!o) return { code: 404, msg: '订单不存在' };
    if (o.status !== 'paid') return { code: 400, msg: '订单状态不正确' };
    o.status = 'checked_in';
    o.inAt = Date.now();
    db.logs.unshift({ type: 'in', plate: o.plate, orderId: o._id, at: Date.now(), gate: '南门入口' });
    persist();
    return { code: 0, data: { order: o } };
  },

  'order/checkout': function (p) {
    const db = loadDB();
    const o = orderOf(p.orderId);
    if (!o) return { code: 404, msg: '订单不存在' };
    if (o.status !== 'checked_in') return { code: 400, msg: '订单状态不正确' };
    const sp = spotOf(o.spotId);
    const extra = util.extraFeeOf(o, sp);
    o.status = 'finished';
    o.outAt = Date.now();
    o.finishedAt = Date.now();
    o.extraAmount = extra;
    const sl = slotOf(o.slotId);
    if (sl) sl.status = 'booked';
    db.logs.unshift({ type: 'out', plate: o.plate, orderId: o._id, at: Date.now(), gate: '南门出口' });
    persist();
    return { code: 0, data: { order: o, extra: extra } };
  },

  /* ===== 物业：道闸放行 ===== */
  'access/whitelist': function () {
    const db = loadDB();
    const list = db.orders.filter(function (o) {
      return o.status === 'paid' || o.status === 'checked_in';
    }).map(function (o) {
      const sl = slotOf(o.slotId) || { date: o.date, from: o.from, to: o.to };
      const sp = spotOf(o.spotId) || { spotNo: '—', building: '—' };
      return util.buildOrderView(o, sl, sp, db.community.split);
    });
    return { code: 0, data: { list: list, community: db.community } };
  },

  'access/verify': function (p) {
    const db = loadDB();
    const plate = util.normPlate(p.plate);
    if (!plate) return { code: 400, msg: '请输入车牌号' };
    const target = db.orders.filter(function (o) {
      const key = o.plateKey || util.normPlate(o.plate);
      return (o.status === 'paid' || o.status === 'checked_in') && key === plate;
    })[0];

    if (!target) {
      return { code: 0, data: { allow: false, plate: plate, msg: '未查询到该车牌的有效预约' } };
    }
    const sl = slotOf(target.slotId) || { date: target.date, from: target.from, to: target.to };
    const sp = spotOf(target.spotId) || { spotNo: '—', building: '—' };
    const now = Date.now();
    const okFrom = util.slotTs(sl.date, sl.from) - 30 * 60000;
    const okTo = util.slotTs(sl.date, sl.to);

    let allow = false, msg = '';
    if (now < okFrom) {
      msg = '预约未到生效时间（开始前 30 分钟生效），' + sl.from + ' 前不可入场';
    } else if (target.status === 'checked_in') {
      allow = true;
      msg = '车辆已在场（车位 ' + sp.spotNo + '），本次仅记录出场';
    } else if (now > okTo) {
      msg = '预约已过期（' + sl.to + ' 失效），不可入场';
    } else {
      allow = true;
      msg = '有效预约 · 车位 ' + sp.spotNo + '（' + sp.building + '）· 通行码 ' + target.code;
    }
    return {
      code: 0,
      data: {
        allow: allow, plate: plate, msg: msg,
        order: util.buildOrderView(target, sl, sp, db.community.split)
      }
    };
  },

  'access/logs': function () {
    const db = loadDB();
    return { code: 0, data: { list: db.logs.slice(0, 30) } };
  },

  /* ===== 物业：数据看板 ===== */
  'admin/stats': function () {
    const db = loadDB();
    const today = util.dateStr(0);
    const todayOrders = db.orders.filter(function (o) {
      return o.date === today && o.status !== 'cancelled' && o.status !== 'unpaid';
    });
    const gmv = todayOrders.reduce(function (a, o) { return a + o.baseAmount + (o.extraAmount || 0); }, 0);
    const approved = db.spots.filter(function (s) { return s.status === 'approved'; }).length;
    const todaySlots = db.slots.filter(function (s) { return s.date === today; });
    const booked = todaySlots.filter(function (s) { return s.status === 'booked' || s.status === 'locked'; }).length;

    return {
      code: 0,
      data: {
        todayCount: todayOrders.length,
        gmv: gmv,
        gmvText: util.money(gmv),
        platformText: util.money(gmv * SPLIT.platform),
        propertyText: util.money(gmv * SPLIT.property),
        ownerText: util.money(gmv * SPLIT.owner),
        approvedSpots: approved,
        totalSpots: db.community.totalSpots,
        rate: approved ? Math.round(booked / approved * 100) : 0,
        inPark: db.orders.filter(function (o) { return o.status === 'checked_in'; }).length,
        totalOrders: db.orders.filter(function (o) { return o.status !== 'cancelled'; }).length,
        totalGmvText: util.money(db.orders.filter(function (o) { return o.status === 'finished'; })
          .reduce(function (a, o) { return a + o.baseAmount + (o.extraAmount || 0); }, 0))
      }
    };
  }
};

/* ---------------- 模拟定时任务（与 cloudfunctions/timer 对齐） ---------------- */
function settleOverdue() {
  const db = loadDB();
  const now = Date.now();
  const AUTO_FINISH_AFTER = 6 * 3600 * 1000;
  let changed = false;

  db.orders.forEach(function (o) {
    if (o.status !== 'checked_in') return;
    const end = util.slotTs(o.date, o.to);
    if (now <= end) return;

    const sp = spotOf(o.spotId) || { pricePerHour: 10, dayCap: 50 };
    const extra = util.extraFeeOf(Object.assign({}, o, { status: 'checked_in' }), sp);
    if (extra !== o.extraAmount) { o.extraAmount = extra; changed = true; }

    if (now > end + AUTO_FINISH_AFTER) {
      o.status = 'finished';
      o.outAt = end + AUTO_FINISH_AFTER;
      o.finishedAt = now;
      o.autoFinished = true;
      changed = true;
    }
  });

  if (changed) persist();
}

/* ---------------- 统一入口 ---------------- */
function handle(name, action, params) {
  settleOverdue();
  const key = name + '/' + action;
  const fn = routes[key];
  if (!fn) {
    return Promise.resolve({ code: 404, msg: '接口不存在：' + key });
  }
  return new Promise(function (resolve) {
    try {
      const out = fn(params || {});
      resolve(out && out.code !== undefined ? out : { code: 0, data: out });
    } catch (e) {
      console.error('[mock]', key, e);
      resolve({ code: 500, msg: e.message || '服务异常' });
    }
  });
}

module.exports = { handle: handle, resetDB: resetDB };
