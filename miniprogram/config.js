/**
 * 全局配置
 * ------------------------------------------------------------
 * USE_MOCK = true   → 走前端内存模拟数据（无需开通云开发，导入即可跑通全流程）
 * USE_MOCK = false  → 走微信云开发（需先开通云开发、创建环境、部署 cloudfunctions）
 */
module.exports = {
  // 是否使用本地模拟数据
  USE_MOCK: true,

  // 云开发环境 ID（USE_MOCK=false 时必填），例如 'linli-parking-1a2b3c'
  CLOUD_ENV: '',

  // 当前小区 ID（云开发时对应 communities 集合的 _id）
  COMMUNITY_ID: 'C001',

  // 是否允许在 Mock 模式下"模拟支付"（正式版关闭）
  ALLOW_MOCK_PAY: true,

  // 版本号
  VERSION: '0.1.0'
};
