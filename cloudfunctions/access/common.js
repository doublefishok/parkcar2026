/**
 * 云函数公共库
 * ------------------------------------------------------------
 * 云函数部署时只会上传各自的目录，因此本文件会由 shared/sync-cloudfn.js
 * 复制到每个云函数目录下（common.js）。修改后请重新运行：
 *     node shared/sync-cloudfn.js
 *
 * 注意：此文件不得使用任何 wx.* 小程序端 API。
 */

const SPLIT = { platform: 0.10, property: 0.15, owner: 0.75 };

/* ---------------- 响应 ---------------- */
function ok(data) { return { code: 0, data: data || {} }; }
function fail(msg, code) { return { code: code || 400, msg: msg }; }

/* ---------------- 时间 ---------------- */
function pad(n) { return n < 10 ? '0' + n : '' + n; }
function hmToMin(hm) {
  const a = String(hm).split(':');
  return parseInt(a[0], 10) * 60 + parseInt(a[1] || 0, 10);
}
function hoursBetween(from, to) { return (hmToMin(to) - hmToMin(from)) / 60; }
function slotTs(date, hm) { return new Date(String(date).replace(/-/g, '/') + ' ' + hm + ':00').getTime(); }
function dateStr(offset) {
  const d = new Date();
  d.setDate(d.getDate() + (offset || 0));
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
function fmtHours(h) { return String(Math.round(h * 10) / 10); }
function money(n) {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return '¥' + (v % 1 === 0 ? v.toFixed(0) : v.toFixed(2));
}
function weekdayCn(str) { return '周' + '日一二三四五六'[new Date(str + 'T00:00:00').getDay()]; }
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
  const d = new Date();
  return 'LL' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + String(Math.floor(Math.random() * 9000) + 1000);
}

function extraFeeOf(order, spot) {
  if (order.status !== 'checked_in') return 0;
  const end = slotTs(order.date, order.to);
  const now = Date.now();
  if (now <= end) return 0;
  const overH = Math.ceil((now - end) / 3600000);
  return Math.round(overH * spot.pricePerHour * 1.5);
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
  const ownerIncome = Math.round((order.baseAmount + (order.extraAmount || 0)) * s.owner);

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
    totalText: money(order.baseAmount + (order.extraAmount || 0)),
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
  ok: ok, fail: fail,
  pad: pad, dateStr: dateStr, dayLabel: dayLabel, weekdayCn: weekdayCn,
  hmToMin: hmToMin, hoursBetween: hoursBetween, slotTs: slotTs, fmtHours: fmtHours, money: money,
  normPlate: normPlate, isValidPlate: isValidPlate,
  calcPrice: calcPrice, genCode: genCode, genOrderNo: genOrderNo,
  extraFeeOf: extraFeeOf, orderStatusMeta: orderStatusMeta,
  buildSlotView: buildSlotView, buildOrderView: buildOrderView
};
