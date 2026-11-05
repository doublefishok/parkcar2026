const cloud = require('wx-server-sdk');
const common = require('./common.js');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

/**
 * 登录 / 用户
 * action: profile | setRole | updateProfile
 */
exports.main = async function (event) {
  const wxContext = cloud.getWXContext();
  const OPENID = wxContext.OPENID;
  const action = event.action || 'profile';

  try {
    if (action === 'profile') {
      const res = await db.collection('users').where({ _openid: OPENID }).limit(1).get();
      let user = res.data[0];

      if (!user) {
        const doc = {
          _openid: OPENID,
          nickName: '邻居' + String(OPENID).slice(-4),
          phone: '',
          role: 'renter',
          building: '',
          createdAt: Date.now()
        };
        const addRes = await db.collection('users').add({ data: doc });
        user = Object.assign({ _id: addRes._id }, doc);
      }

      let community = {};
      try {
        const cRes = await db.collection('communities').limit(1).get();
        community = cRes.data[0] || {};
      } catch (e) { /* 集合可能尚未初始化 */ }

      return common.ok({ user: user, community: community, split: common.SPLIT });
    }

    if (action === 'setRole') {
      const role = event.role;
      if (['renter', 'owner', 'property'].indexOf(role) < 0) {
        return common.fail('角色不合法');
      }
      // 物业角色需要白名单校验（生产环境应由管理员在后台分配）
      if (role === 'property') {
        const res = await db.collection('users').where({ _openid: OPENID }).limit(1).get();
        const u = res.data[0] || {};
        if (!u.isAdmin) return common.fail('无物业管理权限，请联系物业开通', 403);
      }
      await db.collection('users').where({ _openid: OPENID }).update({ data: { role: role } });
      return common.ok({ role: role });
    }

    if (action === 'updateProfile') {
      const patch = {};
      if (event.nickName) patch.nickName = String(event.nickName).slice(0, 20);
      if (event.phone) patch.phone = String(event.phone).slice(0, 20);
      if (event.building) patch.building = String(event.building).slice(0, 20);
      await db.collection('users').where({ _openid: OPENID }).update({ data: patch });
      return common.ok(patch);
    }

    return common.fail('未知操作：' + action, 404);
  } catch (e) {
    console.error('[login]', action, e);
    return common.fail(e.message || '服务异常', 500);
  }
};
