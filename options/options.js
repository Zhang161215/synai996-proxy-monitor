/**
 * Synai996 Proxy Monitor - 设置页逻辑
 */
document.addEventListener('DOMContentLoaded', async () => {
  const apiUrlInput = document.getElementById('apiUrl');
  const accessTokenInput = document.getElementById('accessToken');
  const userIdInput = document.getElementById('userId');
  const testBtn = document.getElementById('testBtn');
  const saveBtn = document.getElementById('saveBtn');
  const importBtn = document.getElementById('importBtn');
  const testResult = document.getElementById('testResult');
  const toggleToken = document.getElementById('toggleToken');

  // 加载已保存的设置
  const config = await chrome.storage.sync.get(['apiUrl', 'accessToken', 'userId', 'theme', 'badgeSource']);
  apiUrlInput.value = config.apiUrl || 'https://api.synai996.space';
  accessTokenInput.value = config.accessToken || '';
  userIdInput.value = config.userId || '';

  // 主题设置
  const savedTheme = config.theme || 'system';
  document.querySelectorAll('input[name="theme"]').forEach(r => {
    r.checked = r.value === savedTheme;
  });
  applyTheme(savedTheme);

  document.querySelectorAll('input[name="theme"]').forEach(r => {
    r.addEventListener('change', (e) => {
      const theme = e.target.value;
      applyTheme(theme);
      chrome.storage.sync.set({ theme });
    });
  });

  // Badge 数据源设置
  const savedBadge = config.badgeSource || 'wallet';
  document.querySelectorAll('input[name="badgeSource"]').forEach(r => {
    r.checked = r.value === savedBadge;
  });

  document.querySelectorAll('input[name="badgeSource"]').forEach(r => {
    r.addEventListener('change', (e) => {
      chrome.storage.sync.set({ badgeSource: e.target.value });
      // 立即刷新 badge
      chrome.runtime.sendMessage({ action: 'refresh' });
    });
  });

  // 切换令牌可见性
  toggleToken.addEventListener('click', () => {
    const isPassword = accessTokenInput.type === 'password';
    accessTokenInput.type = isPassword ? 'text' : 'password';
  });

  // 从已登录的标签页导入
  importBtn.addEventListener('click', async () => {
    importBtn.disabled = true;
    showResult('loading', '正在从已打开的 NewAPI 标签页导入...');

    try {
      const response = await chrome.runtime.sendMessage({ action: 'importFromPage' });
      if (response.error) {
        showResult('error', `导入失败: ${response.error}`);
      } else if (response.data) {
        apiUrlInput.value = response.data.apiUrl || apiUrlInput.value;
        userIdInput.value = response.data.userId || userIdInput.value;
        showResult(
          'success',
          `导入成功！\n` +
          `站点: ${response.data.apiUrl}\n` +
          `用户: ${response.data.displayName || response.data.username || '未知'} (ID: ${response.data.userId})\n` +
          `分组: ${response.data.group || '—'}`,
        );
      } else {
        showResult('error', '导入未返回数据');
      }
    } catch (err) {
      showResult('error', `导入出错: ${err.message}`);
    }

    importBtn.disabled = false;
  });

  // 测试连接
  testBtn.addEventListener('click', async () => {
    const apiUrl = apiUrlInput.value.replace(/\/+$/, '');
    const token = accessTokenInput.value.trim();
    const userId = parseInt(userIdInput.value, 10) || 0;

    if (!apiUrl || !userId) {
      showResult('error', '请填写 API 地址和用户 ID');
      return;
    }

    showResult('loading', '正在测试连接...');
    testBtn.disabled = true;

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'testConnection',
        apiUrl,
        accessToken: token,
        userId,
      });

      if (response.error) {
        showResult('error', `连接失败: ${response.error}`);
      } else if (response.data) {
        const user = response.data;
        showResult('success',
          `连接成功！\n` +
          `用户: ${user.display_name || user.username} (ID: ${user.id})\n` +
          `分组: ${user.group}\n` +
          `余额: $${(user.quota / 500000).toFixed(2)}`
        );
      } else {
        showResult('error', '返回格式异常');
      }
    } catch (err) {
      showResult('error', `错误: ${err.message}`);
    }

    testBtn.disabled = false;
  });

  // 保存设置
  saveBtn.addEventListener('click', async () => {
    const settings = {
      apiUrl: apiUrlInput.value.replace(/\/+$/, ''),
      accessToken: accessTokenInput.value.trim(),
      userId: parseInt(userIdInput.value, 10) || 0,
    };

    if (!settings.apiUrl || !settings.userId) {
      showResult('error', '请先填写 API 地址和用户 ID');
      return;
    }

    await chrome.storage.sync.set(settings);

    // 触发数据刷新
    chrome.runtime.sendMessage({ action: 'refresh' });

    showResult('success', '设置已保存！数据即将刷新。');
    setTimeout(() => { testResult.hidden = true; }, 2000);
  });

  /** 显示操作结果 */
  function showResult(type, message) {
    testResult.hidden = false;
    testResult.className = `test-result ${type}`;
    testResult.textContent = message;
  }

  /** 应用主题 */
  function applyTheme(theme) {
    if (theme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else if (theme === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }
});
