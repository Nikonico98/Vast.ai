// ============================================================
// config.js - API Configuration
// ============================================================
// 配置说明:
// - API_BASE_URL: SAM3/SAM3D 后端地址
// - OPENAI_API_BASE_URL: OpenAI 故事生成后端地址
// ============================================================

const CONFIG = {
  // SAM3/SAM3D 后端 API 地址 (使用相对路径，自动适配 ngrok)
  API_BASE_URL: "",

  // OpenAI 故事生成后端 API 地址
  // 使用空字符串表示相对路径，自动适配当前域名
  // 例如: ngrok 下会自动使用 https://niko.ngrok.app/api/...
  OPENAI_API_BASE_URL: "",

  // 状态轮询间隔 (毫秒)
  POLLING_INTERVAL: 2000,

  // 最大轮询次数 (防止无限轮询)
  MAX_POLLING_ATTEMPTS: 300,

  // 每个故事需要上传的照片数量
  PHOTOS_PER_STORY: 3,

  // API 请求超时时间 (毫秒), 0 表示不限时
  API_TIMEOUT: 30000,

  // 跳过 3D 生成 (用于快速测试 Story 流程)
  // 设为 true 跳过 SAM3/SAM3D，只显示图片
  // 设为 false 启用完整 3D 生成流程
  // 现在在 Vast.ai 上，启用完整 3D 管道！
  SKIP_3D_GENERATION: false,

  // 调试模式
  DEBUG: true,
};

// 日志工具
const Logger = {
  log: (...args) => {
    if (CONFIG.DEBUG) {
      console.log("[IW]", ...args);
    }
  },
  error: (...args) => {
    console.error("[IW Error]", ...args);
  },
  warn: (...args) => {
    if (CONFIG.DEBUG) {
      console.warn("[IW Warning]", ...args);
    }
  },
};

// 导出配置 (支持 ES6 模块和全局变量两种方式)
if (typeof module !== "undefined" && module.exports) {
  module.exports = { CONFIG, Logger };
}
