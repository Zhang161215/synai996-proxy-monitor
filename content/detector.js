/**
 * Synai996 Proxy Monitor - 登录状态检测器（Content Script）
 * 
 * 自动注入到 synai996.space 页面，检测 localStorage 中的用户登录信息，
 * 并主动上报给 Service Worker。比 executeScript 更可靠，不受其他扩展干扰。
 */

(function () {
  'use strict';

  // 检测并上报用户登录状态
  function detectAndReport() {
    try {
      const raw = localStorage.getItem('user');
      if (!raw) {
        console.log('[Synai996 检测器] 未找到 localStorage.user，用户未登录');
        return;
      }

      const user = JSON.parse(raw);
      if (!user || !user.id) {
        console.log('[Synai996 检测器] localStorage.user 数据无效:', raw);
        return;
      }

      const payload = {
        action: 'userDetected',
        data: {
          apiUrl: window.location.origin,
          userId: user.id,
          username: user.username || '',
          displayName: user.display_name || '',
          group: user.group || '',
        },
      };

      console.log('[Synai996 检测器] 检测到登录用户:', user.display_name || user.username, '(ID:', user.id, ')');
      chrome.runtime.sendMessage(payload);
    } catch (err) {
      console.warn('[Synai996 检测器] 检测出错:', err.message);
    }
  }

  // 页面加载完成后立即检测
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    detectAndReport();
  } else {
    document.addEventListener('DOMContentLoaded', detectAndReport);
  }

  // 监听 storage 变化（用户登录/登出时更新）
  window.addEventListener('storage', (e) => {
    if (e.key === 'user') {
      console.log('[Synai996 检测器] localStorage.user 发生变化，重新检测...');
      detectAndReport();
    }
  });

  // 监听来自 popup/service-worker 的查询请求
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'queryUser') {
      try {
        const raw = localStorage.getItem('user');
        if (!raw) {
          sendResponse({ found: false });
          return;
        }
        const user = JSON.parse(raw);
        if (!user || !user.id) {
          sendResponse({ found: false });
          return;
        }
        sendResponse({
          found: true,
          apiUrl: window.location.origin,
          userId: user.id,
          username: user.username || '',
          displayName: user.display_name || '',
          group: user.group || '',
        });
      } catch {
        sendResponse({ found: false });
      }
      return true; // 异步响应
    }
  });
})();
