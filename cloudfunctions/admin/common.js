/**
 * 云函数公共库
 * ------------------------------------------------------------
 * 云函数部署时只会上传各自的目录，因此本文件会由 shared/sync-cloudfn.js
 * 复制到每个云函数目录下（common.js）。修改后请重新运行：
 *     node shared/sync-cloudfn.js
 *
 * 注意：
 *  1. 此文件不得使用任何 wx.* 小程序端 API。
 *  2. 云函数运行时区默认是 UTC，所有"日期/时刻"计算必须显式按东八区处理，
 *     严禁依赖 new Date() 的本地时区行为（否则北京时间 0:00–8:00 会算错一天）。
 */

const SPLIT = { platform: 0.10, property: 0.15, owner: 0.75 };

/** 东八区偏移（毫秒） */
const TZ_OFFSET = 8 * 3600 * 1000;

/** 超时费上限倍数：最多按 2 个日封顶收取，避免出现天价超时费 */
const OVERDUE_CAP_RATIO = 2;

/** 取消规则：开始前 2 小时以上全额退；2 小时内退 50% */
const CANCEL_RULES = {
  freeBeforeMs: 2 * 3600 * 1000,
  feeRatio: 0.5
};

/** 业主临时收回车位的补偿比例（从业主应得收入中扣） */
const OWNER_CANCEL_PENALTY_RATIO = 0.3;

/* ---------------- 响应 ---------------- */
function ok(data) { return { code: 0, data: data || {} }; }
function fail(msg, code) { return { code: code || 400, msg: msg }; }

/* ---------------- 时间（全部基于东八区） ---------------- */

/** 当前"北京墙钟"时间对象（请用 getUTCxxx 读取年月日时分） */
function nowCN() { return new Date(Date.now() + TZ_OFFSET); }

function pad(n) { return n < 10 ? '0' + n : '' + n; }

/** YYYY-MM-DD（北京时间） */
function dateStr(offset) {
  const d = nowCN();
  d.setUTCDate(d.getUTCDate() + (offset || 0));
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
}

function hmToMin(hm) {
  const a = String(hm).split(':');
  return parseInt(a[0], 10) * 60 + parseInt(a[1] || 0, 10);
}
function hoursBetween(from, to) { return (hmToMin(to) - hmToMin(from)) / 60; }

/**
 * 北京时间的「某日某时刻」→ 真实 UTC 时间戳
 * 例：slotTs('2026-11-07', '08:00') === Date.UTC(2026,10,7,0,0)
 */
function slotTs(date, hm) {
  const d = String(date).split('-').map(Number);
  const t = String(hm).split(':').map(Number);
  return Date.UTC(d[0], d[1] - 1, d[2], (t[0] || 0), (t[1] || 0)) - TZ_OFFSET;
}

function fmtHours(h) { return String(Math.round(h * 10) / 10); }

function money(n) {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return '¥' + (v % 1 === 0 ? v.toFixed(0) : v.toFixed(2));
}

function weekdayCn(str) {
  const d = String(str).split('-').map(Number);
  return '周' + '日一二三四五六'[new Date(Date.UTC(d[0], d[1] - 1, d[2])).getUTCDay()];
}

function dayLabel(str) {
  if (str === dateStr(0)) return '今天';
  if (str === dateStr(1)) return '明天';
  if (str === dateStr(2)) return '后天';
  return String(str).slice(5).replace('-', '/');
}

/* ---------------- 车牌 ---------------- */
function normPlate(p) { return String(p || '').replace(/[\s·.．\-]/g, '').toUpperCase(); }
function isValidPlate(p) {
  const s = normPlate(p);
  return s.length >= 6 && s.length <= 8 && /^[\u4e00-\u9fa5A-Z0-9]+$/.test(s);
}

/* ---------------- 计价 ---------------- */
function calcPrice(spot, slot) {
  return Math.round(Math.min(hoursBetween(slot.from, slot.to) * spot.pricePerHour, spot.dayCap));
}

function genCode() { return String(Math.floor(100000 + Math.random() * 900000)); }

function genOrderNo() {
  const d = nowCN();
  return 'LL' + d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate())
    + String(Math.floor(Math.random() * 9000) + 1000);
}

/**
 * 超时费：超出小时数 × 时价 × 1.5，且不超过 2 倍日封顶
 * 同时取「实时计算值」与「已落库值」的较大者，保证定时任务累计过的金额不会被回退。
 */
function extraFeeOf(order, spot) {
  if (order.status !== 'checked_in' && order.status !== 'finished') return order.extraAmount || 0;

  const end = slotTs(order.date, order.to);
  const now = Date.now();
  let live = 0;
  if (order.status === 'checked_in' && now > end) {
    const overH = Math.ceil((now - end) / 3600000);
    live = Math.round(overH * spot.pricePerHour * 1.5);
    const cap = Math.round((spot.dayCap || 0) * OVERDUE_CAP_RATIO);
    if (cap > 0 && live > cap) live = cap;
  }
  return Math.max(live, order.extraAmount || 0);
}

/**
 * 租客取消已支付订单时的退款金额
 *  - 开始前 >= 2 小时：全额退
 *  - 开始前 <  2 小时：退 50%
 */
function refundOf(order) {
  const base = order.baseAmount || 0;
  if (order.status !== 'paid') return 0;
  const start = slotTs(order.date, order.from);
  const lead = start - Date.now();
  if (lead >= CANCEL_RULES.freeBeforeMs) return base;
  return Math.round(base * (1 - CANCEL_RULES.feeRatio));
}

/** 业主取消订单时的补偿金额 */
function ownerPenaltyOf(order) {
  return Math.round((order.baseAmount || 0) * OWNER_CANCEL_PENALTY_RATIO);
}

function orderStatusMeta(order) {
  const map = {
    unpaid: { label: '待支付', cls: 'tag-gray' },
    paid: { label: '待入场', cls: 'tag-blue' },
    checked_in: { label: '停放中', cls: 'tag-green' },
    finished: { label: '已完成', cls: 'tag-gray' },
    cancelled: { label: '已取消', cls: 'tag-gray' },
    refunded: { label: '已退款', cls: 'tag-amber' }
  };
  return map[order.status] || { label: order.status, cls: 'tag-gray' };
}

/* ---------------- 视图（与小程序端保持完全一致） ---------------- */
function buildSlotView(slot, spot) {
  const hours = hoursBetween(slot.from, slot.to);
  const price = calcPrice(spot, slot);
  const now = Date.now();
  const end = slotTs(slot.date, slot.to);
  let state = slot.status;
  if (state === 'available' && now > end) state = 'expired';

  return {
    id: slot._id,
    spotId: spot._id,
    date: slot.date,
    dateLabel: dayLabel(slot.date),
    weekday: weekdayCn(slot.date),
    from: slot.from,
    to: slot.to,
    timeText: slot.from + '–' + slot.to,
    hoursText: fmtHours(hours) + ' 小时',
    price: price,
    priceText: money(price),
    unitText: money(spot.pricePerHour) + '/时 · 日封顶 ' + money(spot.dayCap),
    spotNo: spot.spotNo,
    building: spot.building,
    ownerName: spot.ownerName,
    available: state === 'available',
    stateText: state === 'available' ? '可租' : state === 'booked' ? '已租出' : state === 'locked' ? '锁定中' : state === 'expired' ? '已过期' : '不可租',
    stateCls: state === 'available' ? 'tag-green' : state === 'booked' ? 'tag-gray' : 'tag-red'
  };
}

function buildOrderView(order, slot, spot, split) {
  const meta = orderStatusMeta(order);
  const extra = extraFeeOf(order, spot);
  const s = split || SPLIT;
  const isLive = order.status === 'paid' || order.status === 'checked_in';
  const overdue = order.status === 'checked_in' && Date.now() > slotTs(order.date, order.to);
  const ownerIncome = Math.round((order.baseAmount + extra) * s.owner);

  return {
    id: order._id,
    orderNo: order.orderNo,
    spotNo: spot.spotNo,
    building: spot.building,
    renterName: order.renterName,
    plate: order.plate,
    date: order.date,
    dateLabel: dayLabel(order.date),
    timeText: order.from + '–' + order.to,
    baseText: money(order.baseAmount),
    extra: extra,
    extraText: money(extra),
    totalText: money(order.baseAmount + extra),
    income: ownerIncome,
    incomeText: money(ownerIncome),
    statusLabel: overdue ? '超时中' : meta.label,
    statusCls: overdue ? 'tag-red' : meta.cls,
    code: order.code || '',
    isLive: isLive,
    overdue: overdue,
    showCode: order.status === 'paid' || order.status === 'checked_in',
    canCheckin: order.status === 'paid',
    canCheckout: order.status === 'checked_in'
  };
}

module.exports = {
  SPLIT: SPLIT,
  TZ_OFFSET: TZ_OFFSET,
  OVERDUE_CAP_RATIO: OVERDUE_CAP_RATIO,
  CANCEL_RULES: CANCEL_RULES,
  OWNER_CANCEL_PENALTY_RATIO: OWNER_CANCEL_PENALTY_RATIO,
  refundOf: refundOf,
  ownerPenaltyOf: ownerPenaltyOf,
  ok: ok, fail: fail,
  nowCN: nowCN, pad: pad, dateStr: dateStr, dayLabel: dayLabel, weekdayCn: weekdayCn,
  hmToMin: hmToMin, hoursBetween: hoursBetween, slotTs: slotTs, fmtHours: fmtHours, money: money,
  normPlate: normPlate, isValidPlate: isValidPlate,
  calcPrice: calcPrice, genCode: genCode, genOrderNo: genOrderNo,
  extraFeeOf: extraFeeOf, orderStatusMeta: orderStatusMeta,
  buildSlotView: buildSlotView, buildOrderView: buildOrderView
};
