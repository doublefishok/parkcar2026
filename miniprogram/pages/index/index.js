const app = getApp();
const api = require('../../utils/api.js');
const util = require('../../utils/util.js');

Page({
  data: {
    user: {},
    community: {},
    role: 'renter',
    availableCount: 0,
    liveCount: 0,
    ownerSpot: null,
    avatarText: '邻',
    loading: true
  },

  onShow() {
    this.setData({ role: app.globalData.role });
    this.load();
  },

  load() {
    const that = this;
    const d0 = util.dateStr(0), d1 = util.dateStr(1), d2 = util.dateStr(2);

    Promise.all([
      api.call('login', 'profile'),
      api.call('spot', 'list', { date: d0 }),
      api.call('spot', 'list', { date: d1 }),
      api.call('spot', 'list', { date: d2 }),
      api.call('order', 'list', { scope: 'renter' }),
      api.call('spot', 'my')
    ]).then(function (res) {
      const profile = res[0].data || {};
      const all = (res[1].data.list || []).concat(res[2].data.list || []).concat(res[3].data.list || []);
      const orders = res[4].data.list || [];
      const mySpot = (res[5].data && res[5].data.spot) ? res[5].data.spot : null;

      app.globalData.user = profile.user;
      app.globalData.community = profile.community;

      that.setData({
        user: profile.user || {},
        community: profile.community || {},
        availableCount: all.filter(function (x) { return x.available; }).length,
        liveCount: orders.filter(function (x) { return x.isLive; }).length,
        ownerSpot: mySpot,
        avatarText: (profile.user && profile.user.nickName) ? profile.user.nickName.slice(0, 1) : '邻',
        loading: false
      });
    });
  },

  onRole(e) {
    const role = e.currentTarget.dataset.role;
    app.setRole(role);
    this.setData({ role: role });
  },

  goFind() {
    wx.navigateTo({ url: '/pages/find/find' });
  },

  goHost() {
    app.setRole('owner');
    this.setData({ role: 'owner' });
    wx.navigateTo({ url: '/pages/host/host' });
  },

  goOrders() {
    wx.navigateTo({ url: '/pages/orders/orders' });
  },

  goProperty() {
    app.setRole('property');
    this.setData({ role: 'property' });
    wx.navigateTo({ url: '/pages/property/property' });
  },

  goProfile() {
    wx.navigateTo({ url: '/pages/profile/profile' });
  },

  onApply() {
    wx.navigateTo({ url: '/pages/host/host?apply=1' });
  }
});
