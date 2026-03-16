/**
 * Synai996 Proxy Monitor - 后台服务（Service Worker）
 * 负责定期刷新数据、缓存管理、Badge 更新
 * 零配置：通过 content script 自动检测 NewAPI 登录状态
 */

importScripts('../shared/api.js');

const ALARM_NAME = 'synai996-refresh';
const REFRESH_INTERVAL = 5; // 分钟

// ─── 定时器设置 ───

chrome.runtime.onInstalled.addListener(async () => {
  console.log('[Synai996] 插件已安装/更新');
  chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: 0.5,
    periodInMinutes: REFRESH_INTERVAL,
  });

  // 安装后尝试自动发现（通过 content script 查询已打开的标签页）
  await autoDiscover();
});

// Service Worker 启动时，如果没有配置则尝试自动发现
chrome.runtime.onStartup.addListener(async () => {
  console.log('[Synai996] Service Worker 启动');
  const config = await getConfig();
  if (!config.userId) {
    await autoDiscover();
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    refreshAllData();
  }
});

// ─── 消息处理 ───

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // 来自 content script 的用户登录状态上报
  if (msg.action === 'userDetected' && msg.data) {
    handleUserDetected(msg.data);
    sendResponse({ ok: true });
    return;
  }

  if (msg.action === 'refresh') {
    refreshAllData()
      .then(() => sendResponse({ ok: true }))
      .catch(e => sendResponse({ error: e.message }));
    return true; // 异步响应
  }

  if (msg.action === 'getData') {
    getCachedData()
      .then(data => sendResponse(data))
      .catch(e => sendResponse({ error: e.message }));
    return true;
  }

  if (msg.action === 'testConnection') {
    testConnection(msg.apiUrl, msg.accessToken, msg.userId)
      .then(data => sendResponse(data))
      .catch(e => sendResponse({ error: e.message }));
    return true;
  }

  if (msg.action === 'importFromPage') {
    importFromLoggedInPage()
      .then(data => sendResponse(data))
      .catch(e => sendResponse({ error: e.message }));
    return true;
  }

  if (msg.action === 'autoDiscover') {
    autoDiscover()
      .then(data => sendResponse(data))
      .catch(e => sendResponse({ error: e.message }));
    return true;
  }
});

// ─── 处理 Content Script 上报的登录信息 ───

async function handleUserDetected(data) {
  const config = await getConfig();

  // 如果已经配置了相同的用户，跳过
  if (config.userId === data.userId && config.apiUrl) {
    console.log('[Synai996] 用户信息已存在，跳过:', data.userId);
    return;
  }

  console.log('[Synai996] 收到 content script 上报的用户信息:', data.displayName || data.username, '(ID:', data.userId, ')');

  await chrome.storage.sync.set({
    apiUrl: data.apiUrl,
    userId: data.userId,
  });

  // 立即刷新数据
  try {
    await refreshAllData();
    console.log('[Synai996] 自动配置完成，数据已刷新');
  } catch (err) {
    console.warn('[Synai996] 自动配置后刷新数据失败:', err.message);
  }
}

// ─── 数据刷新 ───

async function refreshAllData() {
  const config = await getConfig();
  if (!config.userId) {
    updateBadge('?', '#888888');
    return;
  }

  try {
    // 并行获取所有数据
    const [profileRes, subscriptionRes, tokensRes, rankingRes, plansRes] = await Promise.allSettled([
      fetchUserProfile(),
      fetchSubscription(),
      fetchTokens(),
      fetchDailyRanking(),
      fetchSubscriptionPlans(),
    ]);

    // 构建每日用量日期范围（最近30天）
    const now = new Date();
    const endDate = now.toISOString().split('T')[0];
    const startDate = new Date(now.getTime() - 30 * 86400 * 1000).toISOString().split('T')[0];

    const [dailyUsageRes] = await Promise.allSettled([
      fetchDailyUsage(startDate, endDate),
    ]);

    const cachedData = {
      timestamp: Date.now(),
      profile: profileRes.status === 'fulfilled' ? profileRes.value : null,
      subscription: subscriptionRes.status === 'fulfilled' ? subscriptionRes.value : null,
      tokens: tokensRes.status === 'fulfilled' ? tokensRes.value : null,
      ranking: rankingRes.status === 'fulfilled' ? rankingRes.value : null,
      plans: plansRes.status === 'fulfilled' ? plansRes.value : null,
      dailyUsage: dailyUsageRes.status === 'fulfilled' ? dailyUsageRes.value : null,
    };

    await chrome.storage.local.set({ cachedData });

    // 根据配置更新 Badge（钱包余额 或 订阅额度）
    const badgeCfg = await chrome.storage.sync.get(['badgeSource']);
    const badgeSource = badgeCfg.badgeSource || 'wallet'; // 默认钱包

    if (badgeSource === 'subscription' && cachedData.subscription?.data?.subscriptions?.length) {
      // 订阅模式：取第一个 active 订阅的额度百分比
      const subs = cachedData.subscription.data.subscriptions;
      const activeSub = subs.find(s => (s.subscription || s).status === 'active') || subs[0];
      const sub = activeSub.subscription || activeSub;
      const total = sub.amount_total || 0;
      const used = sub.amount_used || 0;
      if (total > 0) {
        const remainPercent = Math.round(((total - used) / total) * 100);
        const color = remainPercent > 50 ? '#22c55e' : remainPercent > 20 ? '#f59e0b' : '#ef4444';
        updateBadge(`${remainPercent}%`, color);
      } else {
        updateBadge('--', '#888888');
      }
    } else if (cachedData.profile?.data) {
      // 钱包模式（默认）
      const user = cachedData.profile.data;
      const quota = user.quota || 0;
      const usedQuota = user.used_quota || 0;
      const totalQuota = quota + usedQuota;

      if (totalQuota > 0) {
        const remainPercent = Math.round((quota / totalQuota) * 100);
        const color = remainPercent > 50 ? '#22c55e' : remainPercent > 20 ? '#f59e0b' : '#ef4444';
        updateBadge(`${remainPercent}%`, color);
      } else {
        updateBadge('--', '#888888');
      }
    }

    return cachedData;
  } catch (err) {
    console.error('[Synai996] 数据刷新失败:', err);
    updateBadge('!', '#ef4444');
    throw err;
  }
}

async function getCachedData() {
  const result = await chrome.storage.local.get('cachedData');
  return result.cachedData || null;
}

function updateBadge(text, color) {
  chrome.action.setBadgeText({ text: String(text) });
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeTextColor({ color: '#ffffff' });
}

// ─── 连接测试 ───

async function testConnection(apiUrl, accessToken, userId) {
  if (!userId) {
    throw new Error('需要提供用户 ID');
  }

  const url = `${apiUrl}/api/user/self`;
  const response = await fetch(url, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'New-Api-User': String(userId),
      ...(accessToken ? { Authorization: accessToken } : {}),
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const data = await response.json();

  if (data.success === false) {
    throw new Error(data.message || '认证失败');
  }

  return data;
}

// ─── 从已打开的标签页导入 ───

async function importFromLoggedInPage() {
  // 方式一：通过 content script 消息查询（更可靠）
  try {
    const result = await queryContentScripts();
    if (result) {
      await chrome.storage.sync.set({
        apiUrl: result.apiUrl,
        userId: result.userId,
      });
      return { success: true, data: result };
    }
  } catch (err) {
    console.warn('[Synai996] content script 查询失败:', err.message);
  }

  // 方式二：回退到 executeScript（兼容已打开但 content script 未注入的页面）
  const tabs = await chrome.tabs.query({});
  const targetOrigins = ['https://synai996.space', 'https://api.synai996.space'];

  const matchingTabs = tabs.filter(t => {
    if (!t.url) return false;
    try {
      const origin = new URL(t.url).origin;
      return targetOrigins.includes(origin);
    } catch { return false; }
  });

  if (matchingTabs.length === 0) {
    throw new Error('未找到 synai996.space 的标签页。请先在浏览器中打开并登录 NewAPI。');
  }

  console.log('[Synai996] 尝试 executeScript 读取', matchingTabs.length, '个标签页');

  for (const tab of matchingTabs) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          try {
            const raw = localStorage.getItem('user');
            if (!raw) return { ok: false };
            const user = JSON.parse(raw);
            if (!user || !user.id) return { ok: false };
            return {
              ok: true,
              origin: window.location.origin,
              user,
            };
          } catch { return { ok: false }; }
        },
      });

      const result = results?.[0]?.result;
      if (result?.ok && result.user?.id) {
        const imported = {
          apiUrl: result.origin,
          userId: result.user.id,
          username: result.user.username || '',
          displayName: result.user.display_name || '',
          group: result.user.group || '',
        };

        await chrome.storage.sync.set({
          apiUrl: imported.apiUrl,
          userId: imported.userId,
        });

        return { success: true, data: imported };
      }
    } catch (e) {
      console.warn('[Synai996] executeScript 对标签', tab.id, '失败:', e.message);
      continue;
    }
  }

  throw new Error('未在任何标签页中找到 NewAPI 登录状态。请先登录 NewAPI 网站。');
}

// ─── 通过 Content Script 消息查询用户信息 ───

async function queryContentScripts() {
  const tabs = await chrome.tabs.query({ url: ['*://synai996.space/*', '*://*.synai996.space/*'] });

  if (tabs.length === 0) {
    console.log('[Synai996] 未找到 synai996.space 标签页');
    return null;
  }

  console.log('[Synai996] 通过 content script 查询', tabs.length, '个标签页');

  for (const tab of tabs) {
    try {
      const response = await sendTabMessage(tab.id, { action: 'queryUser' }, 3000);
      if (response?.found) {
        console.log('[Synai996] content script 返回用户:', response.displayName || response.username);
        return {
          apiUrl: response.apiUrl,
          userId: response.userId,
          username: response.username,
          displayName: response.displayName,
          group: response.group,
        };
      }
    } catch (err) {
      console.warn('[Synai996] 标签', tab.id, '查询失败:', err.message);
      continue;
    }
  }

  return null;
}

/**
 * 向指定标签页发送消息，带超时保护
 */
function sendTabMessage(tabId, message, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('消息超时')), timeoutMs);

    chrome.tabs.sendMessage(tabId, message, (response) => {
      clearTimeout(timer);
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

// ─── 自动发现 ───

async function autoDiscover() {
  // 优先通过 content script 查询
  try {
    const result = await queryContentScripts();
    if (result) {
      await chrome.storage.sync.set({
        apiUrl: result.apiUrl,
        userId: result.userId,
      });
      console.log('[Synai996] 自动发现成功:', result.apiUrl, '用户:', result.userId);

      // 触发数据刷新
      refreshAllData().catch(() => {});

      return { success: true, data: result };
    }
  } catch (err) {
    console.warn('[Synai996] 自动发现失败:', err.message);
  }

  updateBadge('?', '#888888');
  return { success: false, reason: '需要先在浏览器中登录 NewAPI' };
}
