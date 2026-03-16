/**
 * Synai996 Proxy API 客户端
 * 公共模块，负责与 NewAPI 后端通信
 */

const DEFAULT_API_URL = 'https://api.synai996.space';
const QUOTA_PER_UNIT = 500000; // 1 美元 = 500000 配额单位
const CACHE_TTL = 5 * 60 * 1000; // 5 分钟缓存有效期

function normalizeApiUrl(url) {
  return (url || DEFAULT_API_URL).replace(/\/+$/, '');
}

/**
 * 获取已保存的配置
 */
async function getConfig() {
  const result = await chrome.storage.sync.get(['apiUrl', 'accessToken', 'userId']);
  return {
    apiUrl: normalizeApiUrl(result.apiUrl || DEFAULT_API_URL),
    accessToken: result.accessToken || '',
    userId: result.userId || 0,
  };
}

/**
 * 保存配置
 */
async function saveConfig(config) {
  await chrome.storage.sync.set(config);
}

/**
 * 发送已认证的 API 请求
 * @param {string} endpoint - API 路径（如 '/api/user/self'）
 * @param {object} options - fetch 选项
 * @returns {Promise<object>} 解析后的 JSON 响应
 */
async function apiRequest(endpoint, options = {}) {
  const config = await getConfig();
  if (!config.userId) throw new Error('未配置用户 ID');

  const url = `${config.apiUrl}${endpoint}`;
  const headers = buildUserAuthHeaders(config, options.headers);

  const response = await fetch(url, {
    ...options,
    headers,
    credentials: 'include', // 始终携带 session cookie
  });

  if (!response.ok) {
    throw new Error(`HTTP_${response.status}`);
  }

  const data = await response.json();
  if (!data.success && data.message) {
    throw new Error(data.message);
  }

  return data;
}

/**
 * 构建用户认证请求头
 */
function buildUserAuthHeaders(config, extraHeaders = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'New-Api-User': String(config.userId),
    ...extraHeaders,
  };

  if (config.accessToken) {
    headers.Authorization = config.accessToken;
  }

  return headers;
}

/**
 * 获取用户资料
 */
async function fetchUserProfile() {
  return apiRequest('/api/user/self');
}

/**
 * 获取订阅信息
 */
async function fetchSubscription() {
  return apiRequest('/api/subscription/self');
}

/**
 * 获取用量统计
 * @param {object} params - 筛选参数
 */
async function fetchUsageStats(params = {}) {
  const query = new URLSearchParams(params).toString();
  return apiRequest(`/api/log/self/stat?${query}`);
}

/**
 * 获取每日用量数据
 * @param {string} startDate - 起始日期 YYYY-MM-DD
 * @param {string} endDate - 结束日期 YYYY-MM-DD
 */
async function fetchDailyUsage(startDate, endDate) {
  return apiRequest(`/api/data/self?start_timestamp=${dateToTimestamp(startDate)}&end_timestamp=${dateToTimestamp(endDate)}`);
}

/**
 * 获取用户日志（用于模型用量分析）
 * @param {object} params - 查询参数
 */
async function fetchLogs(params = {}) {
  const query = new URLSearchParams(params).toString();
  return apiRequest(`/api/log/self?${query}`);
}

/**
 * 获取 API 令牌列表
 */
async function fetchTokens() {
  return apiRequest('/api/token/?p=0&size=100');
}

/**
 * 获取可用模型列表
 */
async function fetchModels() {
  return apiRequest('/api/user/models');
}

/**
 * 获取每日排名
 */
async function fetchDailyRanking() {
  return apiRequest('/api/analytics/daily-ranking');
}

/**
 * 获取订阅套餐列表（用于 plan_id -> title 映射）
 */
async function fetchSubscriptionPlans() {
  return apiRequest('/api/subscription/plans');
}

/**
 * 获取系统状态（无需认证，但仍使用认证头）
 */
async function fetchSystemStatus() {
  const config = await getConfig();
  const url = `${config.apiUrl}/api/status`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  return response.json();
}

// ─── 工具函数 ───

/** 配额转美元 */
function quotaToUSD(quota) {
  return (quota / QUOTA_PER_UNIT).toFixed(2);
}

/** 配额转人民币 */
function quotaToCNY(quota, rate = 7.2) {
  return (quota / QUOTA_PER_UNIT * rate).toFixed(2);
}

/** 格式化配额显示 */
function formatQuota(quota) {
  const usd = quota / QUOTA_PER_UNIT;
  if (usd >= 1000) return `$${(usd / 1000).toFixed(1)}k`;
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  return `$${usd.toFixed(4)}`;
}

/** 日期字符串转 Unix 时间戳 */
function dateToTimestamp(dateStr) {
  return Math.floor(new Date(dateStr + 'T00:00:00').getTime() / 1000);
}

/** Unix 时间戳转日期字符串 */
function timestampToDate(ts) {
  return new Date(ts * 1000).toISOString().split('T')[0];
}

/** 格式化日期显示 */
function formatDate(ts) {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 格式化日期时间显示 */
function formatDateTime(ts) {
  const d = new Date(ts * 1000);
  return `${formatDate(ts)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 计算到期天数 */
function daysUntil(ts) {
  if (!ts || ts === 0) return Infinity;
  const now = Date.now() / 1000;
  return Math.ceil((ts - now) / 86400);
}

/** 计算使用百分比 */
function getUsagePercent(used, total) {
  if (!total || total === 0) return 0;
  return Math.min(100, (used / total) * 100);
}
