// lib/storage.js — chrome.storage abstraction for settings, rules, and API key

const Storage = (() => {
  const KEYS = {
    API_KEY: 'claude_api_key',
    RULES: 'removal_rules',
    SETTINGS: 'extension_settings',
    CONTEXT_MEMORY: 'context_memory',
    STATS: 'session_stats',
    ERRORS: 'recent_errors'
  };

  const DEFAULT_SETTINGS = {
    enabled: true,
    confidenceThreshold: 0.7,
    maxApiCallsPerPage: 5,
    autoScanOnLoad: true,
    selfHealingEnabled: true
  };

  async function get(key) {
    const result = await chrome.storage.local.get(key);
    return result[key];
  }

  async function set(key, value) {
    await chrome.storage.local.set({ [key]: value });
  }

  // API Key
  async function getApiKey() {
    return await get(KEYS.API_KEY) || '';
  }

  async function setApiKey(key) {
    await set(KEYS.API_KEY, key);
  }

  async function clearApiKey() {
    await chrome.storage.local.remove(KEYS.API_KEY);
  }

  // Rules
  async function getRules() {
    return await get(KEYS.RULES) || [];
  }

  async function saveRule(rule) {
    const rules = await getRules();
    const existing = rules.findIndex(r => r.id === rule.id);
    if (existing >= 0) {
      rules[existing] = { ...rules[existing], ...rule };
    } else {
      rules.push(rule);
    }
    await set(KEYS.RULES, rules);
    return rules;
  }

  async function saveRules(newRules) {
    const rules = await getRules();
    for (const rule of newRules) {
      const existing = rules.findIndex(r => r.id === rule.id);
      if (existing >= 0) {
        rules[existing] = { ...rules[existing], ...rule };
      } else {
        rules.push(rule);
      }
    }
    await set(KEYS.RULES, rules);
    return rules;
  }

  async function deleteRule(ruleId) {
    const rules = await getRules();
    const filtered = rules.filter(r => r.id !== ruleId);
    await set(KEYS.RULES, filtered);
    return filtered;
  }

  async function updateRule(ruleId, updates) {
    const rules = await getRules();
    const index = rules.findIndex(r => r.id === ruleId);
    if (index >= 0) {
      rules[index] = { ...rules[index], ...updates };
      await set(KEYS.RULES, rules);
    }
    return rules;
  }

  // Settings
  async function getSettings() {
    const settings = await get(KEYS.SETTINGS);
    return { ...DEFAULT_SETTINGS, ...settings };
  }

  async function updateSettings(updates) {
    const settings = await getSettings();
    const merged = { ...settings, ...updates };
    await set(KEYS.SETTINGS, merged);
    return merged;
  }

  // Context Memory
  async function getContextMemory() {
    return await get(KEYS.CONTEXT_MEMORY) || '';
  }

  async function setContextMemory(memory) {
    await set(KEYS.CONTEXT_MEMORY, memory);
  }

  // Stats
  async function getStats() {
    return await get(KEYS.STATS) || { removedThisSession: 0, totalScans: 0 };
  }

  async function updateStats(updates) {
    const stats = await getStats();
    const merged = { ...stats, ...updates };
    await set(KEYS.STATS, merged);
    return merged;
  }

  async function incrementStat(key, amount = 1) {
    const stats = await getStats();
    stats[key] = (stats[key] || 0) + amount;
    await set(KEYS.STATS, stats);
    return stats;
  }

  // Errors
  async function getErrors() {
    return await get(KEYS.ERRORS) || [];
  }

  async function addError(error) {
    const errors = await getErrors();
    errors.push({ ...error, timestamp: Date.now() });
    // Ring buffer: keep last 20
    while (errors.length > 20) errors.shift();
    await set(KEYS.ERRORS, errors);
    return errors;
  }

  async function clearErrors() {
    await set(KEYS.ERRORS, []);
  }

  // Garbage collection: prune rules not seen in 30 days
  async function pruneStaleRules() {
    const rules = await getRules();
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const kept = rules.filter(r => {
      if (r.createdBy === 'user') return true; // never auto-prune user rules
      if (r.lastSeen && r.lastSeen > thirtyDaysAgo) return true;
      if (r.timestamp && r.timestamp > thirtyDaysAgo) return true;
      return false;
    });
    await set(KEYS.RULES, kept);
    return kept;
  }

  return {
    getApiKey, setApiKey, clearApiKey,
    getRules, saveRule, saveRules, deleteRule, updateRule,
    getSettings, updateSettings,
    getContextMemory, setContextMemory,
    getStats, updateStats, incrementStat,
    getErrors, addError, clearErrors,
    pruneStaleRules
  };
})();

if (typeof globalThis !== 'undefined') {
  globalThis.Storage = Storage;
}
