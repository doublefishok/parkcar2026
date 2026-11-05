const cloud = require('wx-server-sdk');
const common = require('./common.js');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

async function mySpot(OPENID) {
  const r = await db.collection('spots').where({ ownerOpenid: OPENID }).limit(1).get();
  return r.data[0] || null;
}

async function hasOverlap(spotId, date, from, to) {
  const r = await db.collection('slots')
    .where({ spotId: spotId, date: date, status: _.neq('cancelled') })
    .limit(50).get();
  return r.data.some(function (s) {
    return common.hmToMin(from) < common.hmToMin(s.to) && common.hmToMin(to) > common.hmToMin(s.from);
  });
}

/**
 * 空闲时段
 * action: publish | publishWeekend | unpublish | my
 */
exports.main = async function (event) {
  const OPENID = cloud.getWXContext().OPENID;
  const action = event.action;

  try {
    if (action === 'publish') {
      const spot = await mySpot(OPENID);
      if (!spot) return common.fail('请先完成车位备案');
      if (spot.status !== 'approved') return common.fail('车位尚未通过物业审核');
      if (!event.date || !event.from || !event.to) return common.fail('请选择完整时段');
      if (common.hmToMin(event.to) <= common.hmToMin(event.from)) return common.fail('结束时间需晚于开始时间');
      if (await hasOverlap(spot._id, event.date, event.from, event.to)) return common.fail('该时段与已发布时段重叠');

      const doc = {
        _openid: OPENID,
        spotId: spot._id,
        ownerOpenid: OPENID,
        date: event.date,
        from: event.from,
        to: event.to,
        status: 'available',
        createdAt: Date.now()
      };
      const r = await db.collection('slots').add({ data: doc });
      return common.ok({ slot: common.buildSlotView(Object.assign({ _id: r._id }, doc), spot) });
    }

    if (action === 'publishWeekend') {
      const spot = await mySpot(OPENID);
      if (!spot) return common.fail('请先完成车位备案');
      if (spot.status !== 'approved') return common.fail('车位尚未通过物业审核');

      // 云函数运行在 UTC，必须显式用北京时间的「今天 / 星期几」
      const cn = common.nowCN();
      const y = cn.getUTCFullYear(), mo = cn.getUTCMonth(), d = cn.getUTCDate();
      const delta = (6 - cn.getUTCDay() + 7) % 7 || 7;
      const sat = new Date(Date.UTC(y, mo, d + delta));
      const sun = new Date(Date.UTC(y, mo, d + delta + 1));
      const fmt = function (dt) {
        return dt.getUTCFullYear() + '-' + common.pad(dt.getUTCMonth() + 1) + '-' + common.pad(dt.getUTCDate());
      };

      const created = [];
      for (const date of [fmt(sat), fmt(sun)]) {
        if (await hasOverlap(spot._id, date, '08:00', '20:00')) continue;
        const doc = {
          _openid: OPENID, spotId: spot._id, ownerOpenid: OPENID,
          date: date, from: '08:00', to: '20:00', status: 'available', createdAt: Date.now()
        };
        const r = await db.collection('slots').add({ data: doc });
        created.push(common.buildSlotView(Object.assign({ _id: r._id }, doc), spot));
      }
      if (!created.length) return common.fail('本周末时段已发布过');
      return common.ok({ list: created });
    }

    if (action === 'unpublish') {
      let slot = null;
      try { slot = (await db.collection('slots').doc(event.slotId).get()).data; } catch (e) { slot = null; }
      if (!slot) return common.fail('时段不存在', 404);
      if (slot.ownerOpenid !== OPENID) return common.fail('无权操作', 403);
      if (slot.status !== 'available') return common.fail('该时段已被预约，无法下架');
      await db.collection('slots').doc(event.slotId).update({ data: { status: 'cancelled' } });
      return common.ok({});
    }

    if (action === 'my') {
      const spot = await mySpot(OPENID);
      if (!spot) return common.ok({ list: [] });
      const r = await db.collection('slots').where({ spotId: spot._id }).orderBy('date', 'asc').limit(100).get();
      return common.ok({ list: r.data.map(function (s) { return common.buildSlotView(s, spot); }) });
    }

    return common.fail('未知操作：' + action, 404);
  } catch (e) {
    console.error('[slot]', action, e);
    return common.fail(e.message || '服务异常', 500);
  }
};
