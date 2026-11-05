const cloud = require('wx-server-sdk');
const common = require('./common.js');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

/**
 * 订阅消息发送器
 * ------------------------------------------------------------
 * 模板 ID 与字段映射配置在 communities.notifyTemplates，例如：
 * {
 *   "notifyTemplates": {
 *     "paid":     { "templateId": "TMPL_ID_1", "page": "pages/orders/orders", "fields": { "spot": "thing1", "time": "time2", "amount": "amount3" } },
 *     "startSoon":{ "templateId": "TMPL_ID_2", "page": "pages/orders/orders", "fields": { "spot": "thing1", "time": "time2" } },
 *     "endSoon":  { "templateId": "TMPL_ID_3", "page": "pages/orders/orders", "fields": { "spot": "thing1", "time": "time2" } },
 *     "overdue":  { "templateId": "TMPL_ID_4", "page": "pages/orders/orders", "fields": { "spot": "thing1", "amount": "amount3" } }
 *   }
 * }
 *
 * 未配置模板时返回 skipped，不抛错，保证主流程不受影响。
 *
 * action: send | templates
 */
exports.main = async function (event) {
  const action = event.action || 'send';

  try {
    if (action === 'templates') {
      const c = (await db.collection('communities').limit(1).get()).data[0] || {};
      return common.ok({ templates: c.notifyTemplates || {} });
    }

    if (action === 'send') {
      const key = event.key;
      const toOpenid = event.toOpenid;
      if (!key || !toOpenid) return common.fail('缺少参数 key / toOpenid');

      const c = (await db.collection('communities').limit(1).get()).data[0] || {};
      const cfg = (c.notifyTemplates || {})[key];
      if (!cfg || !cfg.templateId) {
        return common.ok({ skipped: true, reason: '未配置模板：' + key });
      }

      try {
        await cloud.openapi.subscribeMessage.send({
          touser: toOpenid,
          templateId: cfg.templateId,
          page: event.page || cfg.page || 'pages/orders/orders',
          data: event.data || {},
          miniprogramState: event.miniprogramState || 'formal'
        });
        return common.ok({ sent: true });
      } catch (e) {
        // 43101：用户未订阅 / 订阅次数已用尽，属正常情况
        return common.ok({
          skipped: true,
          reason: e.errCode === 43101 ? '用户未订阅或订阅次数已用尽' : (e.errMsg || '发送失败')
        });
      }
    }

    return common.fail('未知操作：' + action, 404);
  } catch (e) {
    console.error('[notify]', action, e);
    return common.fail(e.message || '服务异常', 500);
  }
};
