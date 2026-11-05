const app = getApp();
const api = require('../../utils/api.js');
const util = require('../../utils/util.js');
const config = require('../../config.js');

Page({
  data: {
    user: {},
    community: {},
    role: 'renter',
    avatarText: '邻',
    roles: [
      { key: 'renter', name: '租客', desc: '查找并预约车位', ico: '🚗' },
      { key: 'owner', name: '业主', desc: '发布空闲时段赚租金', ico: '🅿️' },
      { key: 'property', name: '物业', desc: '审核 / 放行 / 分账', ico: '🏢' }
    ],
    version: config.VERSION,
    mockMode: config.USE_MOCK,
    phoneText: ''
  },

  onShow() {
    this.load();
  },

  load() {
    const that = this;
    api.call('login', 'profile').then(function (res) {
      const user = (res.data && res.data.user) || {};
      that.setData({
        user: user,
        community: (res.data && res.data.community) || {},
        role: app.globalData.role,
        avatarText: user.nickName ? user.nickName.slice(0, 1) : '邻',
        phoneText: util.maskPhone(user.phone)
      });
    });
  },

  onRole(e) {
    const role = e.currentTarget.dataset.role;
    const that = this;
    api.call('user', 'setRole', { role: role }).then(function (res) {
      if (res.code !== 0) { util.toast(res.msg); return; }
      app.setRole(role);
      that.setData({ role: role });
      util.toast('已切换为' + ({ renter: '租客', owner: '业主', property: '物业' })[role], 'success');
    });
  },

  onReset() {
    const that = this;
    wx.showModal({
      title: '重置演示数据',
      content: '会恢复默认车位、订单和收益数据，用于重新演示。',
      success: function (r) {
        if (!r.confirm) return;
        api.call('user', 'reset', {}).then(function () {
          app.setRole('renter');
          util.toast('已重置');
          wx.reLaunch({ url: '/pages/index/index' });
        });
      }
    });
  },

  goIndex() {
    wx.reLaunch({ url: '/pages/index/index' });
  },

  copyVersion() {
    wx.setClipboardData({ data: '邻里车位 v' + config.VERSION });
  }
});
