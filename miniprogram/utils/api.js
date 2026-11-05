/**
 * 统一接口层
 * ------------------------------------------------------------
 * 页面只调用 api.call(云函数名, action, params)
 * Mock 模式 → 走 ./mock/handler
 * 云开发模式 → wx.cloud.callFunction
 *
 * 所有返回统一为 Promise<{ code: 0|4xx, data, msg }>
 */
const config = require('../config.js');

let mockHandler = null;
function getMock() {
  if (!mockHandler) mockHandler = require('./mock.js');
  return mockHandler;
}

function call(name, action, params) {
  const data = Object.assign({ action: action }, params || {});

  if (config.USE_MOCK) {
    return getMock().handle(name, action, params || {});
  }

  if (!wx.cloud) {
    return Promise.resolve({ code: 500, msg: '当前基础库不支持云开发' });
  }
  return wx.cloud.callFunction({ name: name, data: data })
    .then(function (res) {
      const r = res.result || {};
      return { code: r.code === undefined ? 0 : r.code, data: r.data, msg: r.msg };
    })
    .catch(function (err) {
      console.error('[cloud]', name, action, err);
      return { code: 500, msg: '网络异常，请稍后重试' };
    });
}

module.exports = { call: call };
