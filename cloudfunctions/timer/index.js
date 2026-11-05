const cloud = require('wx-server-sdk');
const common = require('./common.js');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const PAY_TIMEOUT = 15 * 60 * 1000;          // 未支付 → 15 分钟释放
const AUTO_FINISH_AFTER = 6 * 3600 * 1000;   // 超时 6 小时后自动封账
const REMIND_LEAD = 30 * 60 * 1000;          // 开始/结束前 30 分钟提醒
const REMIND_OVERDUE_WINDOW = 60 * 60 * 1000; // 超时后 1 小时内提醒一次
const PAGE = 1000;

async function docOrNull(coll, id) {
  try { return (await db.collection(coll).doc(id).get()).data; } catch (e) { return null; }
}

let _notifyCfg = null;
async function notifyConfig() {
  if (_notifyCfg) return _notifyCfg;
  try {
    const c = (await db.collection('communities').limit(1).get()).data[0] || {};
    _notifyCfg = c.notifyTemplates || {};
  } catch (e) {
    _notifyCfg = {};
  }
  return _notifyCfg;
}

/** 发送订阅消息；未配置模板或用户未订阅时安静跳过 */
async function push(key, order, data) {
  const cfg = await notifyConfig();
  const t = cfg[key];
  if (!t || !t.templateId) return false;
  try {
    await cloud.openapi.subscribeMessage.send({
      touser: order.renterOpenid,
      templateId: t.templateId,
      page: t.page || 'pages/orders/orders',
      data: data || {},
      miniprogramState: 'formal'
    });
    return true;
  } catch (e) {
    return false;
  }
}

function buildData(fields, spotNo, timeText, amountText) {
  const f = fields || {};
  const data = {};
  if (f.spot) data[f.spot] = { value: String(spotNo || '—') };
  if (f.time) data[f.time] = { value: String(timeText || '') };
  if (f.amount && amountText) data[f.amount] = { value: String(amountText) };
  return data;
}

/**
 * 定时任务（每 10 分钟）
 * ------------------------------------------------------------
 * 1. 释放超时未支付订单，把锁定车位放回可租
 * 2. 在场且已超时的订单：按当前时间累计超时费并落库
 * 3. 超时超过 6 小时仍未出场：自动封账，避免无限累计
 * 4. 订阅消息提醒：即将入场 / 即将到期 / 已超时
 *
 * 这样即使租客/物业都不点「出场」，超时费依然会被记录和收取。
 */
exports.main = async function () {
  const now = Date.now();
  const result = {
    released: 0, accrued: 0, finished: 0, scanned: 0,
    remindStart: 0, remindEnd: 0, remindOverdue: 0
  };

  try {
    /* ---------- 1. 释放超时未支付 ---------- */
    const unpaid = await db.collection('orders')
      .where({ status: 'unpaid', createdAt: _.lt(now - PAY_TIMEOUT) })
      .limit(PAGE).get();

    for (const o of unpaid.data) {
      await db.collection('orders').doc(o._id).update({
        data: { status: 'cancelled', cancelledAt: now, cancelBy: 'system' }
      });
      await db.collection('slots')
        .where({ _id: o.slotId, status: 'locked' })
        .update({ data: { status: 'available' } });
      result.released++;
    }

    /* ---------- 2 & 3. 在场订单累计超时费 / 自动封账 ---------- */
    let page = 0;
    while (page < 20) {
      const r = await db.collection('orders')
        .where({ status: 'checked_in' })
        .skip(page * PAGE).limit(PAGE).get();
      if (!r.data.length) break;

      for (const o of r.data) {
        result.scanned++;
        const endTs = common.slotTs(o.date, o.to);
        if (now <= endTs) continue;

        const spot = await docOrNull('spots', o.spotId) || { pricePerHour: 10, dayCap: 50 };
        const extra = common.extraFeeOf(Object.assign({}, o, { status: 'checked_in' }), spot);

        const patch = { extraAmount: extra, overdueAt: endTs };

        if (now > endTs + AUTO_FINISH_AFTER) {
          patch.status = 'finished';
          patch.outAt = endTs + AUTO_FINISH_AFTER;
          patch.finishedAt = now;
          patch.autoFinished = true;
          result.finished++;
        } else {
          result.accrued++;
        }

        await db.collection('orders').doc(o._id).update({ data: patch });
      }

      if (r.data.length < PAGE) break;
      page++;
    }

    /* ---------- 4. 订阅消息提醒 ---------- */
    const cfg = await notifyConfig();

    // 4.1 即将入场
    if (cfg.startSoon && cfg.startSoon.templateId) {
      const r = await db.collection('orders').where({ status: 'paid' }).limit(PAGE).get();
      for (const o of r.data) {
        if (o.remindedStart) continue;
        const start = common.slotTs(o.date, o.from);
        const lead = start - now;
        if (lead <= 0 || lead > REMIND_LEAD) continue;
        const spot = await docOrNull('spots', o.spotId) || { spotNo: '—' };
        const sent = await push('startSoon', o, buildData(cfg.startSoon.fields, spot.spotNo, o.from + '–' + o.to, ''));
        await db.collection('orders').doc(o._id).update({
          data: { remindedStart: now, remindedStartSent: sent }
        });
        if (sent) result.remindStart++;
      }
    }

    // 4.2 即将到期 / 4.3 已超时
    const park = await db.collection('orders').where({ status: 'checked_in' }).limit(PAGE).get();
    for (const o of park.data) {
      const endTs = common.slotTs(o.date, o.to);
      const spot = await docOrNull('spots', o.spotId) || { spotNo: '—' };

      if (!o.remindedEnd && cfg.endSoon && cfg.endSoon.templateId) {
        const lead = endTs - now;
        if (lead > 0 && lead <= REMIND_LEAD) {
          const sent = await push('endSoon', o, buildData(cfg.endSoon.fields, spot.spotNo, o.from + '–' + o.to, ''));
          await db.collection('orders').doc(o._id).update({ data: { remindedEnd: now, remindedEndSent: sent } });
          if (sent) result.remindEnd++;
        }
      }

      if (!o.remindedOverdue && cfg.overdue && cfg.overdue.templateId) {
        const late = now - endTs;
        if (late > 0 && late <= REMIND_OVERDUE_WINDOW) {
          const fee = common.extraFeeOf(Object.assign({}, o, { status: 'checked_in' }), spot);
          const sent = await push('overdue', o, buildData(cfg.overdue.fields, spot.spotNo, o.from + '–' + o.to, common.money(fee)));
          await db.collection('orders').doc(o._id).update({ data: { remindedOverdue: now, remindedOverdueSent: sent } });
          if (sent) result.remindOverdue++;
        }
      }
    }

    console.log('[timer]', JSON.stringify(result));
    return common.ok(result);
  } catch (e) {
    console.error('[timer]', e);
    return common.fail(e.message || '定时任务异常', 500);
  }
};
