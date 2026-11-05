const api = require('../../utils/api.js');
const util = require('../../utils/util.js');

Page({
  data: {
    dates: [],
    curDate: '',
    list: [],
    availableCount: 0,
    totalCount: 0,
    loading: true,
    community: {}
  },

  onLoad() {
    const dates = [];
    for (let i = 0; i < 4; i++) {
      const d = util.dateStr(i);
      dates.push({ value: d, day: util.dayLabel(d), week: util.weekdayCn(d) });
    }
    this.setData({ dates: dates, curDate: util.dateStr(0) });
    this.load(util.dateStr(0), true);
  },

  onShow() {
    if (this.data.curDate) this.load(this.data.curDate, false);
  },

  load(date, allowSmartJump) {
    const that = this;
    this.setData({ loading: true });
    api.call('spot', 'list', { date: date }).then(function (res) {
      const list = (res.data && res.data.list) || [];
      const avail = list.filter(function (x) { return x.available; }).length;

      // 今天已无车可租时，自动跳到明天（避免首屏空列表）
      if (allowSmartJump && avail === 0 && list.length === 0 && date === util.dateStr(0)) {
        const next = util.dateStr(1);
        that.setData({ curDate: next });
        that.load(next, false);
        return;
      }

      that.setData({
        list: list,
        availableCount: avail,
        totalCount: list.length,
        loading: false
      });
    });
  },

  onDate(e) {
    const date = e.currentTarget.dataset.value;
    if (date === this.data.curDate) return;
    this.setData({ curDate: date });
    this.load(date, false);
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pages/detail/detail?slotId=' + id });
  },

  onRefresh() {
    this.load(this.data.curDate, false);
    util.toast('已刷新');
  }
});
