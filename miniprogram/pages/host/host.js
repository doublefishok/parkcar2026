const api = require('../../utils/api.js');
const util = require('../../utils/util.js');
const config = require('../../config.js');

Page({
  data: {
    tab: 'spot',
    mockMode: config.USE_MOCK,

    spot: null,
    slots: [],
    orders: [],

    incomeText: '¥0',
    finishedCount: 0,
    liveCount: 0,
    availableCount: 0,

    // 发布时段
    pubDate: '',
    pubFrom: '08:00',
    pubTo: '20:00',
    estIncome: '¥0',
    today: '',

    // 备案
    showApply: false,
    apply: {
      building: '',
      spotNo: '',
      plate: '',
      pricePerHour: '12',
      dayCap: '60'
    },
    certTypes: ['产权车位', '月租车位'],
    certIndex: 0,

    // 改价
    showPrice: false,
    editPrice: '',
    editCap: ''
  },

  onLoad(options) {
    this.setData({ today: util.dateStr(0), pubDate: util.dateStr(1) });
    if (options && options.apply === '1') {
      this.setData({ showApply: true });
    }
  },

  onShow() {
    this.load();
  },

  load() {
    const that = this;
    Promise.all([
      api.call('spot', 'my'),
      api.call('order', 'list', { scope: 'owner' })
    ]).then(function (res) {
      const myData = res[0].data;
      const orders = (res[1].data && res[1].data.list) || [];
      const spot = myData ? myData.spot : null;
      const slots = myData ? myData.slots : [];

      let income = 0, finished = 0, live = 0, avail = 0;
      orders.forEach(function (o) {
        if (o.statusLabel === '已完成') { income += o.income; finished += 1; }
        else live += 1;
      });
      slots.forEach(function (s) { if (s.available) avail += 1; });

      that.setData({
        spot: spot,
        slots: slots,
        orders: orders,
        incomeText: util.money(income),
        finishedCount: finished,
        liveCount: live,
        availableCount: avail
      });
      that.updateEstimate();
    });
  },

  onTab(e) {
    this.setData({ tab: e.currentTarget.dataset.tab });
  },

  /* ---------- 发布时段 ---------- */
  onPubDate(e) {
    this.setData({ pubDate: e.detail.value });
    this.updateEstimate();
  },
  onPubFrom(e) {
    this.setData({ pubFrom: e.detail.value });
    this.updateEstimate();
  },
  onPubTo(e) {
    this.setData({ pubTo: e.detail.value });
    this.updateEstimate();
  },

  updateEstimate() {
    const d = this.data;
    if (!d.spot) { this.setData({ estIncome: '¥0' }); return; }
    const h = util.hoursBetween(d.pubFrom, d.pubTo);
    if (h <= 0) { this.setData({ estIncome: '时段无效' }); return; }
    const base = Math.min(h * d.spot.pricePerHour, d.spot.dayCap);
    this.setData({ estIncome: util.money(Math.round(base * 0.75)) });
  },

  onPublish() {
    const d = this.data;
    const that = this;
    if (util.hmToMin(d.pubTo) <= util.hmToMin(d.pubFrom)) {
      util.toast('结束时间需晚于开始时间');
      return;
    }
    api.call('slot', 'publish', { date: d.pubDate, from: d.pubFrom, to: d.pubTo }).then(function (res) {
      if (res.code !== 0) { util.toast(res.msg); return; }
      util.toast('发布成功', 'success');
      that.load();
      that.setData({ tab: 'publish' });
    });
  },

  onPublishWeekend() {
    const that = this;
    api.call('slot', 'publishWeekend', {}).then(function (res) {
      if (res.code !== 0) { util.toast(res.msg); return; }
      util.toast('已发布本周末两天', 'success');
      that.load();
    });
  },

  onUnpublish(e) {
    const id = e.currentTarget.dataset.id;
    const that = this;
    wx.showModal({
      title: '下架时段',
      content: '下架后该时段将不再展示给邻居。',
      success: function (r) {
        if (!r.confirm) return;
        api.call('slot', 'unpublish', { slotId: id }).then(function (res) {
          if (res.code !== 0) { util.toast(res.msg); return; }
          util.toast('已下架');
          that.load();
        });
      }
    });
  },

  /* ---------- 车位备案 ---------- */
  openApply() { this.setData({ showApply: true }); },
  closeApply() { this.setData({ showApply: false }); },

  onApplyInput(e) {
    const key = e.currentTarget.dataset.key;
    const patch = {};
    patch['apply.' + key] = e.detail.value;
    this.setData(patch);
  },

  onCertChange(e) {
    this.setData({ certIndex: Number(e.detail.value) });
  },

  submitApply() {
    const a = this.data.apply;
    const that = this;
    if (!a.building.trim() || !a.spotNo.trim()) { util.toast('请填写楼栋与车位号'); return; }
    if (!util.isValidPlate(a.plate)) { util.toast('车牌号格式不正确'); return; }

    api.call('spot', 'apply', {
      building: a.building.trim(),
      spotNo: a.spotNo.trim(),
      plate: a.plate.trim(),
      pricePerHour: Number(a.pricePerHour) || 12,
      dayCap: Number(a.dayCap) || 60,
      certType: this.data.certTypes[this.data.certIndex]
    }).then(function (res) {
      if (res.code !== 0) { util.toast(res.msg); return; }
      that.setData({ showApply: false });
      util.toast('已提交，等待物业审核', 'success');
      that.load();
    });
  },

  /* ---------- 改价 ---------- */
  openPrice() {
    const s = this.data.spot;
    if (!s) return;
    this.setData({ showPrice: true, editPrice: String(s.pricePerHour), editCap: String(s.dayCap) });
  },
  closePrice() { this.setData({ showPrice: false }); },
  onEditPrice(e) { this.setData({ editPrice: e.detail.value }); },
  onEditCap(e) { this.setData({ editCap: e.detail.value }); },

  submitPrice() {
    const d = this.data;
    const that = this;
    const p = Number(d.editPrice);
    const c = Number(d.editCap);
    if (!(p > 0) || !(c > 0)) { util.toast('请输入有效价格'); return; }
    if (c < p) { util.toast('日封顶价不能低于时价'); return; }
    api.call('spot', 'update', { spotId: d.spot._id, pricePerHour: p, dayCap: c }).then(function (res) {
      if (res.code !== 0) { util.toast(res.msg); return; }
      that.setData({ showPrice: false });
      util.toast('已更新');
      that.load();
    });
  },

  /** 业主临时收回车位：全额退租客，并记一笔补偿 */
  onOwnerCancel(e) {
    const id = e.currentTarget.dataset.id;
    const that = this;
    wx.showModal({
      title: '收回车位',
      content: '将全额退款给租客，并从你的收入中扣除订单金额 30% 作为补偿。确定吗？',
      confirmText: '确定收回',
      confirmColor: '#ef4444',
      success: function (r) {
        if (!r.confirm) return;
        api.call('order', 'ownerCancel', { orderId: id }).then(function (res) {
          if (res.code !== 0) { util.toast(res.msg); return; }
          util.toast('已收回，退款 ' + util.money(res.data.refund), 'success');
          that.load();
        });
      }
    });
  },

  goFind() {
    wx.navigateTo({ url: '/pages/find/find' });
  },

  // 阻止弹层内部点击冒泡到遮罩
  noop() {}
});
