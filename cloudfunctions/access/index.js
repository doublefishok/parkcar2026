const cloud = require('wx-server-sdk');
const common = require('./common.js');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

async function docOrNull(coll, id) {
  try { return (await db.collection(coll).doc(id).get()).data; } catch (e) { return null; }
}

async function assertAdmin(OPENID) {
  const r = await db.collection('users').where({ _openid: OPENID }).limit(1).get();
  const u = r.data[0];
  return !!(u && (u.role === 'property' || u.isAdmin));
}

/**
 * 道闸放行
 * action: whitelist | verify | logs
 * 说明：whitelist 是「应放行清单」，物业可导出/下发到道闸；verify 用于实时核验。
 */
exports.main = async function (event) {
  const OPENID = cloud.getWXContext().OPENID;
  const action = event.action;

  try {
    if (action === 'whitelist') {
      if (!(await assertAdmin(OPENID))) return common.fail('无物业管理权限', 403);

      const r = await db.collection('orders')
        .where({ status: _.in(['paid', 'checked_in']) })
        .orderBy('date', 'asc').limit(100).get();

      const slotIds = Array.from(new Set(r.data.map(function (o) { return o.slotId; })));
      const spotIds = Array.from(new Set(r.data.map(function (o) { return o.spotId; })));
      const slots = slotIds.length ? (await db.collection('slots').where({ _id: _.in(slotIds) }).limit(100).get()).data : [];
      const spots = spotIds.length ? (await db.collection('spots').where({ _id: _.in(spotIds) }).limit(100).get()).data : [];

      const smap = {}; slots.forEach(function (s) { smap[s._id] = s; });
      const pmap = {}; spots.forEach(function (p) { pmap[p._id] = p; });

      const list = r.data.map(function (o) {
        const slot = smap[o.slotId] || { date: o.date, from: o.from, to: o.to };
        const spot = pmap[o.spotId] || { spotNo: '—', building: '—' };
        return common.buildOrderView(o, slot, spot, common.SPLIT);
      }).sort(function (a, b) { return (a.date + a.timeText > b.date + b.timeText) ? 1 : -1; });

      let community = {};
      try { community = (await db.collection('communities').limit(1).get()).data[0] || {}; } catch (e) {}

      return common.ok({ list: list, community: community });
    }

    if (action === 'verify') {
      if (!(await assertAdmin(OPENID))) return common.fail('无物业管理权限', 403);

      const plate = common.normPlate(event.plate);
      if (!plate) return common.fail('请输入车牌号');

      const r = await db.collection('orders')
        .where({ status: _.in(['paid', 'checked_in']) }).limit(100).get();
      const target = r.data.filter(function (o) { return common.normPlate(o.plate) === plate; })[0];

      if (!target) {
        return common.ok({ allow: false, plate: plate, msg: '未查询到该车牌的有效预约' });
      }

      const slot = await docOrNull('slots', target.slotId) || { date: target.date, from: target.from, to: target.to };
      const spot = await docOrNull('spots', target.spotId) || { spotNo: '—', building: '—' };

      const now = Date.now();
      const okFrom = common.slotTs(slot.date, slot.from) - 30 * 60000;
      const okTo = common.slotTs(slot.date, slot.to);

      let allow = false, msg = '';
      if (now < okFrom) {
        msg = '预约未到生效时间（开始前 30 分钟生效），' + slot.from + ' 前不可入场';
      } else if (target.status === 'checked_in') {
        allow = true;
        msg = '车辆已在场（车位 ' + spot.spotNo + '），本次仅记录出场';
      } else if (now > okTo) {
        msg = '预约已过期（' + slot.to + ' 失效），不可入场';
      } else {
        allow = true;
        msg = '有效预约 · 车位 ' + spot.spotNo + '（' + spot.building + '）· 通行码 ' + target.code;
      }

      // 记录核验流水（便于追溯与对账）
      try {
        await db.collection('access_logs').add({
          data: {
            orderId: target._id, plate: plate, type: allow ? 'in' : 'denied',
            gate: event.gate || '南门入口', source: 'verify', at: Date.now(), operator: OPENID
          }
        });
      } catch (e) { /* 日志失败不影响放行 */ }

      return common.ok({
        allow: allow, plate: plate, msg: msg,
        order: common.buildOrderView(target, slot, spot, common.SPLIT)
      });
    }

    if (action === 'logs') {
      if (!(await assertAdmin(OPENID))) return common.fail('无物业管理权限', 403);
      const r = await db.collection('access_logs').orderBy('at', 'desc').limit(50).get();
      return common.ok({ list: r.data });
    }

    return common.fail('未知操作：' + action, 404);
  } catch (e) {
    console.error('[access]', action, e);
    return common.fail(e.message || '服务异常', 500);
  }
};
