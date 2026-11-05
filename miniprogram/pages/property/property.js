const api = require('../../utils/api.js');
const util = require('../../utils/util.js');

Page({
  data: {
    tab: 'access',
    list: [],
    community: {},
    verifyPlate: '',
    verifyResult: null,
    pending: [],
    stats: {},
    loading: true
  },

  onShow() {
    this.loadAll();
  },

  loadAll() {
    const that = this;
    Promise.all([
      api.call('access', 'whitelist'),
      api.call('spot', 'pending'),
      api.call('admin', 'stats')
    ]).then(function (res) {
      that.setData({
        list: (res[0].data && res[0].data.list) || [],
        community: (res[0].data && res[0].data.community) || {},
        pending: (res[1].data && res[1].data.list) || [],
        stats: res[2].data || {},
        loading: false
      });
    });
  },

  onTab(e) {
    this.setData({ tab: e.currentTarget.dataset.tab });
  },

  /* ---------- 道闸核验 ---------- */
  onPlateInput(e) {
    this.setData({ verifyPlate: e.detail.value });
  },

  onVerify() {
    const that = this;
    const plate = this.data.verifyPlate.trim();
    if (!plate) { util.toast('请输入车牌号'); return; }
    api.call('access', 'verify', { plate: plate }).then(function (res) {
      if (res.code !== 0) { util.toast(res.msg); return; }
      that.setData({ verifyResult: res.data });
    });
  },

  copyWhitelist() {
    const list = this.data.list;
    if (!list.length) { util.toast('今日暂无放行车辆'); return; }
    const lines = list.map(function (o) {
      return o.plate + '\t' + o.spotNo + '\t' + o.date + ' ' + o.timeText + '\t' + o.code;
    });
    const txt = '车牌\t车位\t时段\t通行码\n' + lines.join('\n');
    wx.setClipboardData({
      data: txt,
      success: function () { util.toast('名单已复制，可粘贴给保安', 'success'); }
    });
  },

  copyCode(e) {
    wx.setClipboardData({ data: e.currentTarget.dataset.code });
  },

  /* ---------- 车位审核 ---------- */
  onApprove(e) {
    const id = e.currentTarget.dataset.id;
    const that = this;
    api.call('spot', 'approve', { spotId: id }).then(function (res) {
      if (res.code !== 0) { util.toast(res.msg); return; }
      util.toast('已通过认证', 'success');
      that.loadAll();
    });
  },

  onReject(e) {
    const id = e.currentTarget.dataset.id;
    const that = this;
    wx.showModal({
      title: '驳回申请',
      content: '请确认已核实产权材料。驳回后该车位不会上架。',
      confirmColor: '#ef4444',
      success: function (r) {
        if (!r.confirm) return;
        api.call('spot', 'reject', { spotId: id }).then(function (res) {
          if (res.code !== 0) { util.toast(res.msg); return; }
          util.toast('已驳回');
          that.loadAll();
        });
      }
    });
  },

  onRefresh() {
    this.loadAll();
    util.toast('已刷新');
  }
});
