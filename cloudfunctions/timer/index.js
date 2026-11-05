const cloud = require('wx-server-sdk');
const common = require('./common.js');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const PAY_TIMEOUT = 15 * 60 * 1000;          // 未支付 → 15 分钟释放
const AUTO_FINISH_AFTER = 6 * 3600 * 1000;   // 超时 6 小时后自动封账
const PAGE = 1000;

async function docOrNull(coll, id) {
  try { return (await db.collection(coll).doc(id).get()).data; } catch (e) { return null; }
}

/**
 * 定时任务（每 10 分钟）
 * ------------------------------------------------------------
 * 1. 释放超时未支付订单，把锁定车位放回可租
 * 2. 在场且已超时的订单：按当前时间累计超时费并落库
 * 3. 超时超过 6 小时仍未出场的订单：自动封账，避免无限累计
 *
 * 这样即使租客/物业都不点「出场」，超时费依然会被记录和收取，
 * 不再依赖客户端主动触发结算。
 */
exports.main = async function () {
  const now = Date.now();
  const result = { released: 0, accrued: 0, finished: 0, scanned: 0 };

  try {
    /* ---------- 1. 释放超时未支付 ---------- */
    const unpaid = await db.collection('orders')
      .where({ status: 'unpaid', createdAt: _.lt(now - PAY_TIMEOUT) })
      .limit(PAGE).get();

    for (const o of unpaid.data) {
      await db.collection('orders').doc(o._id).update({
        data: { status: 'cancelled', cancelledAt: now }
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

    console.log('[timer]', JSON.stringify(result));
    return common.ok(result);
  } catch (e) {
    console.error('[timer]', e);
    return common.fail(e.message || '定时任务异常', 500);
  }
};
