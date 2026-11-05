const api = require('../../utils/api.js');
const util = require('../../utils/util.js');
const config = require('../../config.js');

Page({
  data: {
    slotId: '',
    slot: null,
    spot: null,
    community: {},
    name: '',
    plate: '',
    phone: '',
    loading: true,
    paying: false,
    successOrder: null,
    showSuccess: false
  },

  onLoad(options) {
    this.setData({ slotId: options.slotId || '' });
    this.load();
  },

  load() {
    const that = this;
    api.call('spot', 'detail', { slotId: this.data.slotId }).then(function (res) {
      if (res.code !== 0) {
        util.toast(res.msg || '时段不存在');
        setTimeout(function () { wx.navigateBack(); }, 1200);
        return;
      }
      that.setData({
        slot: res.data.slot,
        spot: res.data.spot,
        community: res.data.community,
        loading: false
      });
    });
  },

  onInput(e) {
    const key = e.currentTarget.dataset.key;
    const patch = {};
    patch[key] = e.detail.value;
    this.setData(patch);
  },

  onPay() {
    const that = this;
    const d = this.data;
    if (d.paying) return;

    if (!d.name.trim()) { util.toast('请填写您的称呼'); return; }
    if (!d.plate.trim()) { util.toast('请填写车牌号'); return; }
    if (!util.isValidPlate(d.plate)) { util.toast('车牌号格式不正确'); return; }
    if (!d.slot.available) { util.toast('该时段已不可预约'); return; }

    this.setData({ paying: true });

    api.call('order', 'create', {
      slotId: d.slotId,
      renterName: d.name.trim(),
      plate: d.plate.trim(),
      phone: d.phone.trim()
    }).then(function (res) {
      if (res.code !== 0) {
        util.toast(res.msg || '下单失败');
        that.setData({ paying: false });
        return;
      }
      const order = res.data.order;

      // ===== 支付 =====
      // Mock 模式：直接模拟支付成功
      // 云开发模式：此处应调用「微信支付」云函数拿 payment 参数，再 wx.requestPayment
      //   详见 README「接入真实微信支付」章节
      if (config.USE_MOCK) {
        api.call('order', 'pay', { orderId: order._id }).then(function (r2) {
          if (r2.code !== 0) {
            util.toast(r2.msg || '支付失败');
            that.setData({ paying: false });
            return;
          }
          that.setData({
            paying: false,
            showSuccess: true,
            successOrder: {
              code: r2.data.order.code,
              plate: r2.data.order.plate,
              spotNo: that.data.slot.spotNo,
              building: that.data.slot.building,
              timeText: that.data.slot.timeText,
              dateLabel: that.data.slot.dateLabel,
              baseText: that.data.slot.priceText
            }
          });
        });
      } else {
        that.setData({ paying: false });
        util.toast('请先接入微信支付');
      }
    });
  },

  closeSuccess() {
    this.setData({ showSuccess: false });
    wx.redirectTo({ url: '/pages/orders/orders' });
  },

  goOrders() {
    wx.redirectTo({ url: '/pages/orders/orders' });
  }
});
