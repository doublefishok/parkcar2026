const config = require('./config.js');

App({
  globalData: {
    role: 'renter',      // renter | owner | property
    user: null,
    community: null,
    ready: false
  },

  onLaunch() {
    // 云开发初始化（Mock 模式下跳过）
    if (!config.USE_MOCK && wx.cloud) {
      wx.cloud.init({ env: config.CLOUD_ENV, traceUser: true });
    }

    // 恢复上次选择的身份
    const role = wx.getStorageSync('role');
    if (role) this.globalData.role = role;

    // 静默登录 / 拉取资料
    this.bootstrap();
  },

  bootstrap() {
    const api = require('./utils/api.js');
    api.call('login', 'profile', {}).then(res => {
      if (res && res.code === 0) {
        this.globalData.user = res.data.user;
        this.globalData.community = res.data.community;
      }
      this.globalData.ready = true;
      if (typeof this.onReadyCallback === 'function') this.onReadyCallback();
    }).catch(() => {
      this.globalData.ready = true;
    });
  },

  setRole(role) {
    this.globalData.role = role;
    wx.setStorageSync('role', role);
  }
});
