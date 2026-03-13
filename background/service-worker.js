// background/service-worker.js — Orchestration: Claude API calls, screenshot capture, self-healing

importScripts('/lib/storage.js', '/lib/claude-client.js');

let apiCallCount = {};  // tabId -> count (per page load)
let scanTimestamps = {}; // tabId -> last scan time

// ── Message Router ────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  switch (message.type) {
    case 'PAGE_READY':
      handlePageReady(tabId, message.url);
      sendResponse({ ack: true });
      break;

    case 'USER_SELECTED_ELEMENT':
      handleUserSelection(tabId, message.elementContext);
      sendResponse({ ack: true });
      break;

    case 'GET_STATUS':
      handleGetStatus(sendResponse);
      return true; // async

    case 'TRIGGER_RESCAN':
      if (message.tabId) {
        handlePageReady(message.tabId, message.url || '');
      }
      sendResponse({ ack: true });
      break;

    case 'GET_ALL_STATS':
      handleGetAllStats(sendResponse);
      return true; // async

    case 'GET_RULES_LIST':
      Storage.getRules().then(rules => sendResponse({ rules }));
      return true;

    case 'DELETE_RULE':
      handleDeleteRule(message.ruleId, message.tabId, sendResponse);
      return true;

    case 'CLEAR_ALL_RULES':
      handleClearAllRules(message.tabId, sendResponse);
      return true;
  }

  return false;
});

// ── Page Ready: Main scan flow ────────────────────────────────
async function handlePageReady(tabId, url) {
  if (!tabId) return;

  const settings = await Storage.getSettings();
  if (!settings.enabled || !settings.autoScanOnLoad) return;

  const apiKey = await Storage.getApiKey();
  if (!apiKey) return;

  // Rate limit: max N calls per page load
  if (!apiCallCount[tabId]) apiCallCount[tabId] = 0;
  if (apiCallCount[tabId] >= (settings.maxApiCallsPerPage || 5)) {
    console.log(`[AdRemover] API call limit reached for tab ${tabId}`);
    return;
  }

  try {
    // Step 1: Capture screenshot
    const screenshot = await captureScreenshot(tabId);

    // Step 2: Get DOM snapshot from content script
    const domData = await sendToContentScript(tabId, {
      type: 'CAPTURE_VIEWPORT'
    });

    // Step 3: Get context memory
    const contextMemory = await Storage.getContextMemory();

    // Step 4: Send to Claude for analysis
    apiCallCount[tabId]++;
    const result = await ClaudeClient.analyzeViewport(
      apiKey, screenshot, domData?.snapshot, contextMemory
    );

    if (!result.rules || result.rules.length === 0) {
      console.log('[AdRemover] No ads detected by Claude');
      return;
    }

    // Step 5: Filter by confidence threshold
    const threshold = settings.confidenceThreshold || 0.7;
    const confident = result.rules.filter(r => r.confidence >= threshold);

    if (confident.length === 0) return;

    // Step 6: Send rules to content script
    const applyResult = await sendToContentScript(tabId, {
      type: 'APPLY_RULES',
      rules: confident
    });

    await Storage.incrementStat('removedThisSession', confident.length);
    await Storage.incrementStat('totalScans');

    // Step 7: Self-healing check
    if (settings.selfHealingEnabled) {
      setTimeout(() => selfHealingCheck(tabId, apiKey, confident), 1500);
    }

    // Step 8: Update context memory (occasionally, not every scan)
    if (apiCallCount[tabId] === 1) {
      try {
        const updatedMemory = await ClaudeClient.updateContextMemory(
          apiKey, contextMemory, confident
        );
        await Storage.setContextMemory(updatedMemory);
      } catch (e) {
        console.warn('[AdRemover] Failed to update context memory:', e);
      }
    }

  } catch (error) {
    console.error('[AdRemover] Scan failed:', error);
    await Storage.addError({
      message: error.message,
      source: 'background-scan',
      type: 'scan-failure'
    });
  }
}

// ── User Selection: Ctrl+click flow ───────────────────────────
async function handleUserSelection(tabId, elementContext) {
  const apiKey = await Storage.getApiKey();
  if (!apiKey) {
    await sendToContentScript(tabId, {
      type: 'APPLY_SINGLE_RULE',
      rule: {
        selector: elementContext.selector,
        reason: 'User-selected element (no API key for generalization)',
        confidence: 1.0,
        createdBy: 'user'
      }
    });
    return;
  }

  try {
    const contextMemory = await Storage.getContextMemory();
    const result = await ClaudeClient.generalizeSelector(
      apiKey, elementContext, contextMemory
    );

    if (result.rule) {
      await sendToContentScript(tabId, {
        type: 'APPLY_SINGLE_RULE',
        rule: {
          ...result.rule,
          createdBy: 'user'
        }
      });
    }
  } catch (error) {
    console.error('[AdRemover] Generalization failed, using raw selector:', error);
    // Fall back to the exact selector
    await sendToContentScript(tabId, {
      type: 'APPLY_SINGLE_RULE',
      rule: {
        selector: elementContext.selector,
        reason: 'User-selected element (generalization failed)',
        confidence: 1.0,
        createdBy: 'user'
      }
    });
  }
}

// ── Self-Healing Check ────────────────────────────────────────
async function selfHealingCheck(tabId, apiKey, appliedRules) {
  try {
    // Re-screenshot after rules applied
    const screenshot = await captureScreenshot(tabId);

    // Get any errors since rules were applied
    const errorData = await sendToContentScript(tabId, {
      type: 'GET_ERRORS',
      since: Date.now() - 2000
    });

    const errors = errorData?.errors || [];

    // Ask Claude to check
    apiCallCount[tabId] = (apiCallCount[tabId] || 0) + 1;
    const check = await ClaudeClient.checkForBreakage(
      apiKey, screenshot, appliedRules, errors
    );

    if (check.broken && check.revert?.length > 0) {
      console.warn('[AdRemover] Self-healing: reverting rules:', check.revert);

      await sendToContentScript(tabId, {
        type: 'REVERT_RULES',
        selectors: check.revert
      });

      await Storage.addError({
        message: `Self-healed: reverted ${check.revert.length} rule(s). Issues: ${check.issues.join('; ')}`,
        source: 'self-healing',
        type: 'self-heal'
      });
    }
  } catch (error) {
    console.warn('[AdRemover] Self-healing check failed:', error);
  }
}

// ── Status / Stats ────────────────────────────────────────────
async function handleGetStatus(sendResponse) {
  const apiKey = await Storage.getApiKey();
  const settings = await Storage.getSettings();
  sendResponse({
    hasApiKey: !!apiKey,
    enabled: settings.enabled,
    settings
  });
}

async function handleGetAllStats(sendResponse) {
  const rules = await Storage.getRules();
  const stats = await Storage.getStats();
  const errors = await Storage.getErrors();
  const tokensUsed = ClaudeClient.getTokensUsed();
  const estimatedCost = ClaudeClient.estimateCost();

  sendResponse({
    rules: {
      total: rules.length,
      enabled: rules.filter(r => !r.disabled).length,
      userCreated: rules.filter(r => r.createdBy === 'user').length,
      claudeCreated: rules.filter(r => r.createdBy === 'claude').length,
      failed: rules.filter(r => r.failures > 0).length
    },
    stats,
    errors: errors.slice(-5), // last 5
    tokensUsed,
    estimatedCost: estimatedCost.toFixed(4)
  });
}

// ── Rule Management ───────────────────────────────────────────
async function handleDeleteRule(ruleId, tabId, sendResponse) {
  await Storage.deleteRule(ruleId);
  // Tell content script to un-hide elements for this rule
  if (tabId) {
    await sendToContentScript(tabId, { type: 'REMOVE_RULE', ruleId });
  }
  const rules = await Storage.getRules();
  sendResponse({ success: true, rules });
}

async function handleClearAllRules(tabId, sendResponse) {
  await chrome.storage.local.set({ removal_rules: [] });
  if (tabId) {
    await sendToContentScript(tabId, { type: 'CLEAR_ALL_RULES' });
  }
  sendResponse({ success: true });
}

// ── Helpers ───────────────────────────────────────────────────
async function captureScreenshot(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab || !tab.active) return null;

    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: 'png',
      quality: 80
    });
    // Strip the data URL prefix to get raw base64
    return dataUrl.replace(/^data:image\/png;base64,/, '');
  } catch (e) {
    console.warn('[AdRemover] Screenshot capture failed:', e);
    return null;
  }
}

function sendToContentScript(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        console.warn('[AdRemover] Content script message failed:', chrome.runtime.lastError.message);
        resolve(null);
      } else {
        resolve(response);
      }
    });
  });
}

// ── Tab lifecycle cleanup ─────────────────────────────────────
chrome.tabs.onRemoved.addListener((tabId) => {
  delete apiCallCount[tabId];
  delete scanTimestamps[tabId];
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    apiCallCount[tabId] = 0;
    scanTimestamps[tabId] = null;
  }
});

// ── Periodic rule pruning (once per day) ──────────────────────
chrome.alarms.create('prune-rules', { periodInMinutes: 1440 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'prune-rules') {
    Storage.pruneStaleRules();
  }
});

console.log('[AdRemover] Background service worker initialized');
