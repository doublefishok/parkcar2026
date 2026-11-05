const cloud = require('wx-server-sdk');
const common = require('./common.js');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

async function assertAdmin(OPENID) {
  const r = await db.collection('users').where({ _openid: OPENID }).limit(1).get();
  const u = r.data[0];
  return !!(u && (u.role === 'property' || u.isAdmin));
}

/**
 * 物业经营看板
 * action: stats
 */
exports.main = async function (event) {
  const OPENID = cloud.getWXContext().OPENID;
  const action = event.action || 'stats';

  try {
    if (action !== 'stats') return common.fail('未知操作：' + action, 404);
    if (!(await assertAdmin(OPENID))) return common.fail('无物业管理权限', 403);

    const today = common.dateStr(0);
    const split = common.SPLIT;

    const todayRes = await db.collection('orders')
      .where({ date: today, status: _.in(['paid', 'checked_in', 'finished']) })
      .limit(100).get();

    const todayOrders = todayRes.data;
    const gmv = todayOrders.reduce(function (a, o) { return a + o.baseAmount + (o.extraAmount || 0); }, 0);

    const approvedRes = await db.collection('spots').where({ status: 'approved' }).count();
    const approvedSpots = approvedRes.total;

    const todaySlotsRes = await db.collection('slots')
      .where({ date: today, status: _.in(['booked', 'locked', 'finished']) }).count();

    const inParkRes = await db.collection('orders').where({ status: 'checked_in' }).count();
    const allRes = await db.collection('orders').where({ status: _.neq('cancelled') }).count();

    const finishedRes = await db.collection('orders').where({ status: 'finished' }).limit(100).get();
    const totalGmv = finishedRes.data.reduce(function (a, o) { return a + o.baseAmount + (o.extraAmount || 0); }, 0);

    let community = { totalSpots: 386 };
    try {
      const cRes = await db.collection('communities').limit(1).get();
      community = cRes.data[0] || community;
    } catch (e) {}

    return common.ok({
      todayCount: todayOrders.length,
      gmv: gmv,
      gmvText: common.money(gmv),
      platformText: common.money(gmv * split.platform),
      propertyText: common.money(gmv * split.property),
      ownerText: common.money(gmv * split.owner),
      approvedSpots: approvedSpots,
      totalSpots: community.totalSpots || 386,
      rate: approvedSpots ? Math.round(todaySlotsRes.total / approvedSpots * 100) : 0,
      inPark: inParkRes.total,
      totalOrders: allRes.total,
      totalGmvText: common.money(totalGmv)
    });
  } catch (e) {
    console.error('[admin]', action, e);
    return common.fail(e.message || '服务异常', 500);
  }
};
