const cloud = require('wx-server-sdk');
const common = require('./common.js');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

async function getSpot(id) {
  try {
    const r = await db.collection('spots').doc(id).get();
    return r.data;
  } catch (e) {
    return null;
  }
}

async function spotsByIds(ids) {
  if (!ids.length) return [];
  const r = await db.collection('spots').where({ _id: _.in(ids) }).limit(100).get();
  return r.data;
}

async function assertAdmin(OPENID) {
  const r = await db.collection('users').where({ _openid: OPENID }).limit(1).get();
  const u = r.data[0];
  return !!(u && (u.role === 'property' || u.isAdmin));
}

/**
 * 车位
 * action: list | detail | my | apply | update | pending | approve | reject
 */
exports.main = async function (event) {
  const OPENID = cloud.getWXContext().OPENID;
  const action = event.action;

  try {
    /* ---- 某日可租车位列表（含已租出） ---- */
    if (action === 'list') {
      const date = event.date || common.dateStr(1);
      const sr = await db.collection('slots')
        .where({ date: date, status: _.in(['available', 'booked', 'locked']) })
        .limit(100).get();

      const spots = await spotsByIds(Array.from(new Set(sr.data.map(function (s) { return s.spotId; }))));
      const map = {};
      spots.forEach(function (s) { map[s._id] = s; });

      const list = sr.data
        .filter(function (s) { return map[s.spotId] && map[s.spotId].status === 'approved'; })
        .map(function (s) { return common.buildSlotView(s, map[s.spotId]); })
        .sort(function (a, b) { return common.hmToMin(a.from) - common.hmToMin(b.from); });

      return common.ok({ list: list, date: date });
    }

    /* ---- 时段详情 ---- */
    if (action === 'detail') {
      let slot = null;
      try {
        slot = (await db.collection('slots').doc(event.slotId).get()).data;
      } catch (e) { slot = null; }
      if (!slot) return common.fail('时段不存在', 404);

      const spot = await getSpot(slot.spotId);
      if (!spot) return common.fail('车位不存在', 404);

      let community = {};
      try { community = (await db.collection('communities').limit(1).get()).data[0] || {}; } catch (e) {}

      return common.ok({ slot: common.buildSlotView(slot, spot), spot: spot, community: community });
    }

    /* ---- 我的车位 ---- */
    if (action === 'my') {
      const sr = await db.collection('spots').where({ ownerOpenid: OPENID }).limit(1).get();
      const spot = sr.data[0];
      if (!spot) return common.ok({ spot: null, slots: [] });

      const slr = await db.collection('slots')
        .where({ spotId: spot._id, status: _.neq('cancelled') })
        .orderBy('date', 'asc').limit(100).get();

      const slots = slr.data
        .map(function (s) { return common.buildSlotView(s, spot); })
        .sort(function (a, b) {
          if (a.date !== b.date) return a.date > b.date ? 1 : -1;
          return common.hmToMin(a.from) - common.hmToMin(b.from);
        });

      return common.ok({ spot: spot, slots: slots });
    }

    /* ---- 车位备案申请 ---- */
    if (action === 'apply') {
      if (!event.building || !event.spotNo) return common.fail('请填写楼栋与车位号');
      if (!common.isValidPlate(event.plate)) return common.fail('车牌号格式不正确');

      const exist = await db.collection('spots').where({ ownerOpenid: OPENID }).limit(1).get();
      if (exist.data.length) return common.fail('您已有备案车位');

      const doc = {
        _openid: OPENID,
        ownerOpenid: OPENID,
        building: String(event.building).slice(0, 20),
        spotNo: String(event.spotNo).slice(0, 20),
        plate: common.normPlate(event.plate),
        pricePerHour: Number(event.pricePerHour) || 12,
        dayCap: Number(event.dayCap) || 60,
        certType: event.certType || '产权车位',
        status: 'pending',
        verifiedAt: '',
        createdAt: Date.now()
      };
      const addRes = await db.collection('spots').add({ data: doc });
      return common.ok({ spot: Object.assign({ _id: addRes._id }, doc) });
    }

    /* ---- 修改价格 ---- */
    if (action === 'update') {
      const spot = await getSpot(event.spotId);
      if (!spot) return common.fail('车位不存在', 404);
      if (spot.ownerOpenid !== OPENID) return common.fail('无权操作', 403);

      const patch = {};
      if (event.pricePerHour) patch.pricePerHour = Math.max(1, Number(event.pricePerHour));
      if (event.dayCap) patch.dayCap = Math.max(1, Number(event.dayCap));
      await db.collection('spots').doc(event.spotId).update({ data: patch });
      return common.ok(patch);
    }

    /* ---- 物业：待审核列表 ---- */
    if (action === 'pending') {
      if (!(await assertAdmin(OPENID))) return common.fail('无物业管理权限', 403);
      const r = await db.collection('spots').where({ status: 'pending' }).orderBy('createdAt', 'desc').limit(50).get();
      return common.ok({ list: r.data });
    }

    /* ---- 物业：通过 / 驳回 ---- */
    if (action === 'approve') {
      if (!(await assertAdmin(OPENID))) return common.fail('无物业管理权限', 403);
      await db.collection('spots').doc(event.spotId).update({
        data: { status: 'approved', verifiedAt: common.dateStr(0), approvedBy: OPENID }
      });
      return common.ok({});
    }

    if (action === 'reject') {
      if (!(await assertAdmin(OPENID))) return common.fail('无物业管理权限', 403);
      await db.collection('spots').doc(event.spotId).update({ data: { status: 'rejected' } });
      const slr = await db.collection('slots').where({ spotId: event.spotId }).limit(100).get();
      for (const s of slr.data) {
        if (s.status === 'available') {
          await db.collection('slots').doc(s._id).update({ data: { status: 'cancelled' } });
        }
      }
      return common.ok({});
    }

    return common.fail('未知操作：' + action, 404);
  } catch (e) {
    console.error('[spot]', action, e);
    return common.fail(e.message || '服务异常', 500);
  }
};
