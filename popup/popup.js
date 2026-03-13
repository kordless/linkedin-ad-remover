// popup/popup.js — Settings dashboard

document.addEventListener('DOMContentLoaded', async () => {
  const apiKeyInput = document.getElementById('api-key');
  const saveKeyBtn = document.getElementById('save-key');
  const clearKeyBtn = document.getElementById('clear-key');
  const enabledToggle = document.getElementById('enabled-toggle');
  const rescanBtn = document.getElementById('rescan-btn');
  const statusEl = document.getElementById('status');
  const statusText = document.getElementById('status-text');
  const rulesCount = document.getElementById('rules-count');
  const removedCount = document.getElementById('removed-count');
  const userRules = document.getElementById('user-rules');
  const apiCost = document.getElementById('api-cost');
  const errorsSection = document.getElementById('errors-section');
  const errorsList = document.getElementById('errors-list');
  const clearLogsBtn = document.getElementById('clear-logs');
  const rulesSection = document.getElementById('rules-section');
  const rulesList = document.getElementById('rules-list');
  const clearAllRulesBtn = document.getElementById('clear-all-rules');

  // ── Load current state ──────────────────────────────────────
  const stored = await chrome.storage.local.get(['claude_api_key', 'extension_settings']);

  if (stored.claude_api_key) {
    apiKeyInput.value = '••••••••••••••••';
    apiKeyInput.dataset.hasKey = 'true';
    setStatus(true);
  }

  const settings = { enabled: true, wideFeed: false, ...stored.extension_settings };
  enabledToggle.checked = settings.enabled;

  const wideFeedToggle = document.getElementById('wide-feed-toggle');
  wideFeedToggle.checked = settings.wideFeed || false;

  // Load stats from background
  refreshStats();

  // ── Save API Key ────────────────────────────────────────────
  saveKeyBtn.addEventListener('click', async () => {
    const key = apiKeyInput.value.trim();
    if (!key || key.startsWith('••')) return;

    await chrome.storage.local.set({ claude_api_key: key });
    apiKeyInput.value = '••••••••••••••••';
    apiKeyInput.dataset.hasKey = 'true';
    setStatus(true);
  });

  // ── Clear API Key ───────────────────────────────────────────
  clearKeyBtn.addEventListener('click', async () => {
    await chrome.storage.local.remove('claude_api_key');
    apiKeyInput.value = '';
    apiKeyInput.dataset.hasKey = 'false';
    setStatus(false);
  });

  // Focus clears masked display
  apiKeyInput.addEventListener('focus', () => {
    if (apiKeyInput.dataset.hasKey === 'true') {
      apiKeyInput.value = '';
      apiKeyInput.placeholder = 'Enter new key...';
    }
  });

  apiKeyInput.addEventListener('blur', () => {
    if (!apiKeyInput.value && apiKeyInput.dataset.hasKey === 'true') {
      apiKeyInput.value = '••••••••••••••••';
      apiKeyInput.placeholder = 'sk-ant-...';
    }
  });

  // ── Toggle Extension ───────────────────────────────────────
  enabledToggle.addEventListener('change', async () => {
    const enabled = enabledToggle.checked;
    await chrome.storage.local.set({
      extension_settings: { ...settings, enabled }
    });

    // Notify active LinkedIn tab
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]?.url?.includes('linkedin.com')) {
      chrome.tabs.sendMessage(tabs[0].id, {
        type: 'TOGGLE_EXTENSION',
        enabled
      });
    }
  });

  // ── Wide Feed Toggle ────────────────────────────────────────
  wideFeedToggle.addEventListener('change', async () => {
    const wideFeed = wideFeedToggle.checked;
    const current = await chrome.storage.local.get('extension_settings');
    await chrome.storage.local.set({
      extension_settings: { ...current.extension_settings, wideFeed }
    });

    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]?.url?.includes('linkedin.com')) {
      chrome.tabs.sendMessage(tabs[0].id, {
        type: 'TOGGLE_WIDE_FEED',
        wideFeed
      });
    }
  });

  // ── Re-scan ─────────────────────────────────────────────────
  rescanBtn.addEventListener('click', async () => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]?.url?.includes('linkedin.com')) {
      chrome.tabs.sendMessage(tabs[0].id, { type: 'RESCAN' });
      rescanBtn.textContent = 'Scanning...';
      setTimeout(() => { rescanBtn.textContent = 'Re-scan Page'; }, 3000);
    } else {
      rescanBtn.textContent = 'Navigate to LinkedIn first';
      setTimeout(() => { rescanBtn.textContent = 'Re-scan Page'; }, 2000);
    }
  });

  // ── Summarize ──────────────────────────────────────────────
  const sumBtn = document.getElementById('summarize-btn');
  const sumStatus = document.getElementById('sum-status');
  const scrollDepth = document.getElementById('scroll-depth');
  const depthLabel = document.getElementById('depth-label');

  scrollDepth.addEventListener('input', () => {
    depthLabel.textContent = scrollDepth.value;
  });

  sumBtn.addEventListener('click', async () => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabUrl = tabs[0]?.url || '';
    if (!tabUrl.includes('linkedin.com')) {
      sumStatus.style.display = 'block';
      sumStatus.textContent = 'Navigate to LinkedIn first';
      setTimeout(() => { sumStatus.style.display = 'none'; }, 2000);
      return;
    }
    // Only allow summarizing the main feed, not notifications/messaging/etc
    const feedPath = new URL(tabUrl).pathname;
    if (feedPath !== '/' && feedPath !== '/feed/' && !feedPath.startsWith('/feed')) {
      sumStatus.style.display = 'block';
      sumStatus.textContent = 'Navigate to your main feed to summarize';
      setTimeout(() => { sumStatus.style.display = 'none'; }, 3000);
      return;
    }

    sumBtn.disabled = true;
    sumBtn.textContent = 'Scrolling...';
    sumStatus.style.display = 'block';
    sumStatus.textContent = 'Scrolling and capturing feed...';

    // Listen for progress updates
    const progressListener = (message) => {
      if (message.type === 'SUM_PROGRESS') {
        sumStatus.textContent = message.status;
      }
      if (message.type === 'SUM_DONE') {
        sumBtn.disabled = false;
        sumBtn.textContent = 'Sum';
        sumStatus.textContent = 'Done — opened in new tab';
        setTimeout(() => { sumStatus.style.display = 'none'; }, 3000);
        chrome.runtime.onMessage.removeListener(progressListener);
      }
      if (message.type === 'SUM_ERROR') {
        sumBtn.disabled = false;
        sumBtn.textContent = 'Sum';
        sumStatus.textContent = 'Error: ' + message.error;
        setTimeout(() => { sumStatus.style.display = 'none'; }, 5000);
        chrome.runtime.onMessage.removeListener(progressListener);
      }
    };
    chrome.runtime.onMessage.addListener(progressListener);

    chrome.runtime.sendMessage({
      type: 'SUMMARIZE_PAGE',
      tabId: tabs[0].id,
      maxScrolls: parseInt(scrollDepth.value, 10)
    });
  });

  // ── Clear Logs ──────────────────────────────────────────────
  clearLogsBtn.addEventListener('click', async () => {
    await chrome.storage.local.set({ recent_errors: [] });
    errorsList.innerHTML = '';
    errorsSection.style.display = 'none';
  });

  // ── Rules List ─────────────────────────────────────────────
  refreshRules();

  clearAllRulesBtn.addEventListener('click', async () => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabId = tabs[0]?.url?.includes('linkedin.com') ? tabs[0].id : null;
    await chrome.runtime.sendMessage({ type: 'CLEAR_ALL_RULES', tabId });
    rulesList.innerHTML = '';
    rulesSection.style.display = 'none';
    refreshStats();
  });

  async function refreshRules() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_RULES_LIST' });
      const rules = response?.rules || [];
      if (rules.length === 0) {
        rulesSection.style.display = 'none';
        return;
      }
      rulesSection.style.display = 'block';
      rulesList.innerHTML = rules.map(rule => {
        const source = rule.createdBy === 'user' ? 'You' : 'AI';
        const status = rule.disabled ? ' (off)' : '';
        return `<div class="rule-item${rule.disabled ? ' disabled' : ''}">
          <div class="rule-info">
            <span class="rule-source">${source}</span>
            <span class="rule-reason">${escapeHtml(rule.reason || rule.selector)}${status}</span>
          </div>
          <button class="btn btn-small btn-undo" data-rule-id="${escapeHtml(rule.id)}">Undo</button>
        </div>`;
      }).join('');

      // Attach undo handlers
      rulesList.querySelectorAll('.btn-undo').forEach(btn => {
        btn.addEventListener('click', async () => {
          const ruleId = btn.dataset.ruleId;
          const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
          const tabId = tabs[0]?.url?.includes('linkedin.com') ? tabs[0].id : null;
          await chrome.runtime.sendMessage({ type: 'DELETE_RULE', ruleId, tabId });
          btn.closest('.rule-item').remove();
          refreshStats();
          // Hide section if empty
          if (rulesList.children.length === 0) {
            rulesSection.style.display = 'none';
          }
        });
      });
    } catch (e) {
      // Background might not be ready
    }
  }

  // ── Full Reset ──────────────────────────────────────────────
  document.getElementById('full-reset').addEventListener('click', async () => {
    const apiKey = await chrome.storage.local.get('claude_api_key');
    // Wipe everything except the API key
    await chrome.storage.local.clear();
    // Restore the API key so user doesn't have to re-enter
    if (apiKey.claude_api_key) {
      await chrome.storage.local.set({ claude_api_key: apiKey.claude_api_key });
    }
    // Tell content script to clear
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]?.url?.includes('linkedin.com')) {
      chrome.tabs.sendMessage(tabs[0].id, { type: 'CLEAR_ALL_RULES' });
    }
    // Reset UI
    rulesCount.textContent = '0';
    removedCount.textContent = '0';
    userRules.textContent = '0';
    apiCost.textContent = '$0.00';
    rulesList.innerHTML = '';
    rulesSection.style.display = 'none';
    errorsList.innerHTML = '';
    errorsSection.style.display = 'none';
  });

  // ── Helpers ─────────────────────────────────────────────────
  function setStatus(connected) {
    statusEl.className = 'status ' + (connected ? 'connected' : 'disconnected');
    statusText.textContent = connected ? 'Connected' : 'Not connected';
  }

  async function refreshStats() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_ALL_STATS' });
      if (response) {
        rulesCount.textContent = response.rules?.total || 0;
        removedCount.textContent = response.stats?.removedThisSession || 0;
        userRules.textContent = response.rules?.userCreated || 0;
        apiCost.textContent = '$' + (response.estimatedCost || '0.00');

        // Show errors if any
        if (response.errors && response.errors.length > 0) {
          errorsSection.style.display = 'block';
          errorsList.innerHTML = response.errors.map(err => {
            const time = new Date(err.timestamp).toLocaleTimeString();
            const cls = err.type === 'self-heal' ? 'error-item self-heal' : 'error-item';
            return `<div class="${cls}">
              <span class="error-time">${time}</span> ${escapeHtml(err.message)}
            </div>`;
          }).join('');
        }
      }
    } catch (e) {
      // Background might not be ready yet
    }
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
});
