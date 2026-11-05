/**
 * 通用工具 & 视图构建
 * ------------------------------------------------------------
 * 时间计算统一按东八区显式处理，不依赖设备/运行时时区，
 * 保证与云函数侧（shared/cloudfn-common.js）结果完全一致。
 */

const TZ_OFFSET = 8 * 3600 * 1000;
const OVERDUE_CAP_RATIO = 2;

function pad(n) {
  return n < 10 ? '0' + n : '' + n;
}

/** 当前"北京墙钟"时间（用 getUTCxxx 读取） */
function nowCN() { return new Date(Date.now() + TZ_OFFSET); }

/** 返回 YYYY-MM-DD（北京时间，相对今天偏移 offset 天） */
function dateStr(offset) {
  const d = nowCN();
  d.setUTCDate(d.getUTCDate() + (offset || 0));
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
}

/** 今天 / 明天 / 后天 / 11-12 */
function dayLabel(str) {
  if (str === dateStr(0)) return '今天';
  if (str === dateStr(1)) return '明天';
  if (str === dateStr(2)) return '后天';
  return String(str).slice(5).replace('-', '/');
}

function weekdayCn(str) {
  const d = String(str).split('-').map(Number);
  return '周' + '日一二三四五六'[new Date(Date.UTC(d[0], d[1] - 1, d[2])).getUTCDay()];
}

/** "08:30" → 510 */
function hmToMin(hm) {
  const a = String(hm).split(':');
  return parseInt(a[0], 10) * 60 + parseInt(a[1] || 0, 10);
}

function minToHm(min) {
  return pad(Math.floor(min / 60)) + ':' + pad(min % 60);
}

/** 两个 HH:mm 之间的小时数 */
function hoursBetween(from, to) {
  return (hmToMin(to) - hmToMin(from)) / 60;
}

function fmtHours(h) {
  return String(Math.round(h * 10) / 10);
}

/** 北京时间「某日某时刻」→ 真实时间戳 */
function slotTs(date, hm) {
  const d = String(date).split('-').map(Number);
  const t = String(hm).split(':').map(Number);
  return Date.UTC(d[0], d[1] - 1, d[2], (t[0] || 0), (t[1] || 0)) - TZ_OFFSET;
}

function money(n) {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return '¥' + (v % 1 === 0 ? v.toFixed(0) : v.toFixed(2));
}

function maskPhone(p) {
  const s = String(p || '');
  return s.length >= 7 ? s.slice(0, 3) + '****' + s.slice(-4) : s;
}

function genCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/** 车牌归一化：去空格、中点、圆点，转大写 */
function normPlate(p) {
  return String(p || '').replace(/[\s·.．\-]/g, '').toUpperCase();
}

function isValidPlate(p) {
  const s = normPlate(p);
  return s.length >= 6 && s.length <= 8 && /^[\u4e00-\u9fa5A-Z0-9]+$/.test(s);
}

/** 计算某车位某时段的标价：min(时长 × 时价, 日封顶) */
function calcPrice(spot, slot) {
  const h = hoursBetween(slot.from, slot.to);
  return Math.round(Math.min(h * spot.pricePerHour, spot.dayCap));
}

/** 订单展示态 */
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

/**
 * 超时费 = 超出小时 × 时价 × 1.5，且不超过 2 倍日封顶
 * 取「实时计算值」与「已落库值」的较大者（定时任务会累计落库）
 */
function extraFeeOf(order, spot) {
  const stored = order.extraAmount || 0;
  if (order.status !== 'checked_in') return stored;
  const end = slotTs(order.date, order.to);
  const now = Date.now();
  if (now <= end) return stored;

  const overH = Math.ceil((now - end) / 3600000);
  let live = Math.round(overH * spot.pricePerHour * 1.5);
  const cap = Math.round((spot.dayCap || 0) * OVERDUE_CAP_RATIO);
  if (cap > 0 && live > cap) live = cap;
  return Math.max(live, stored);
}

/** 时段卡片视图 */
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

/** 订单卡片视图 */
function buildOrderView(order, slot, spot, split) {
  const meta = orderStatusMeta(order);
  const extra = extraFeeOf(order, spot);
  const isLive = order.status === 'paid' || order.status === 'checked_in';
  const overdue = order.status === 'checked_in' && Date.now() > slotTs(order.date, order.to);
  const ownerIncome = Math.round((order.baseAmount + extra) * (split && split.owner != null ? split.owner : 0.75));
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
    canCheckout: order.status === 'checked_in',
    isMine: !!order.__isMine
  };
}

function toast(title, icon) {
  wx.showToast({ title: title, icon: icon || 'none', duration: 1800 });
}

function sleep(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}

module.exports = {
  TZ_OFFSET: TZ_OFFSET,
  OVERDUE_CAP_RATIO: OVERDUE_CAP_RATIO,
  nowCN: nowCN,
  pad: pad,
  dateStr: dateStr,
  dayLabel: dayLabel,
  weekdayCn: weekdayCn,
  hmToMin: hmToMin,
  minToHm: minToHm,
  hoursBetween: hoursBetween,
  fmtHours: fmtHours,
  slotTs: slotTs,
  money: money,
  maskPhone: maskPhone,
  genCode: genCode,
  normPlate: normPlate,
  isValidPlate: isValidPlate,
  calcPrice: calcPrice,
  orderStatusMeta: orderStatusMeta,
  extraFeeOf: extraFeeOf,
  buildSlotView: buildSlotView,
  buildOrderView: buildOrderView,
  toast: toast,
  sleep: sleep
};
