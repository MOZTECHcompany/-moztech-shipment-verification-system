// backend/jest.config.js
// Jest 測試框架配置

module.exports = {
  // 測試環境
  testEnvironment: 'node',

  // 測試文件匹配模式
  testMatch: [
    '**/__tests__/**/*.js',
    '**/*.test.js',
    '**/*.spec.js'
  ],

  // 覆蓋率收集
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/**/*.test.js',
    '!src/**/*.spec.js',
    '!src/server.js'
  ],

  // 覆蓋率閾值
  coverageThresholds: {
    global: {
      branches: 50,
      functions: 50,
      lines: 50,
      statements: 50
    }
  },

  // 覆蓋率報告格式
  coverageReporters: ['text', 'lcov', 'html'],

  // 測試超時時間（毫秒）
  testTimeout: 10000,

  // 清除模擬
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,

  // 詳細輸出
  verbose: true
};
