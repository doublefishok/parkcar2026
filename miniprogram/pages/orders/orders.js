const api = require('../../utils/api.js');
const util = require('../../utils/util.js');
const config = require('../../config.js');

Page({
  data: {
    seg: 'live',
    list: [],
    all: [],
    loading: true,
    mockMode: config.USE_MOCK
  },

  onShow() {
    this.load();
  },

  load() {
    const that = this;
    api.call('order', 'list', { scope: 'renter' }).then(function (res) {
      const all = (res.data && res.data.list) || [];
      that.setData({ all: all, loading: false });
      that.applyFilter(that.data.seg, all);
    });
  },

  applyFilter(seg, source) {
    const all = source || this.data.all;
    const list = seg === 'live'
      ? all.filter(function (o) { return o.isLive || o.statusLabel === '超时中'; })
      : all;
    this.setData({ seg: seg, list: list });
  },

  onSeg(e) {
    this.applyFilter(e.currentTarget.dataset.seg, null);
  },

  copyCode(e) {
    const code = e.currentTarget.dataset.code;
    wx.setClipboardData({ data: code });
  },

  onCheckin(e) {
    const id = e.currentTarget.dataset.id;
    const that = this;
    api.call('order', 'checkin', { orderId: id }).then(function (res) {
      if (res.code !== 0) { util.toast(res.msg); return; }
      util.toast('道闸已抬杆，入场已记录', 'success');
      that.load();
    });
  },

  onCheckout(e) {
    const id = e.currentTarget.dataset.id;
    const that = this;
    api.call('order', 'checkout', { orderId: id }).then(function (res) {
      if (res.code !== 0) { util.toast(res.msg); return; }
      const extra = res.data.extra || 0;
      util.toast(extra > 0 ? '已出场，超时费 ' + util.money(extra) : '已出场结算完成', 'success');
      that.load();
    });
  },

  onCancel(e) {
    const id = e.currentTarget.dataset.id;
    const item = (this.data.all || []).filter(function (o) { return o.id === id; })[0] || {};
    const isPaid = item.statusLabel === '待入场';
    const that = this;

    wx.showModal({
      title: isPaid ? '取消并退款' : '取消订单',
      content: isPaid
        ? '开始前 2 小时以上取消，全额退款；2 小时内取消，退还 50%。退款原路退回。'
        : '确定要取消这笔未支付的订单吗？车位会重新放出。',
      confirmText: isPaid ? '退款' : '取消订单',
      confirmColor: '#ef4444',
      success: function (r) {
        if (!r.confirm) return;
        api.call('order', 'cancel', { orderId: id }).then(function (res) {
          if (res.code !== 0) { util.toast(res.msg); return; }
          const refund = res.data && res.data.refund;
          util.toast(refund > 0 ? '已取消，退款 ' + util.money(refund) : '已取消', 'success');
          that.load();
        });
      }
    });
  },

  onRefresh() {
    this.load();
    util.toast('已刷新');
  },

  goFind() {
    wx.navigateTo({ url: '/pages/find/find' });
  }
});
