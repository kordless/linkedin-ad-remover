// content/rule-engine.js — Applies and manages removal rules in the DOM

const RuleEngine = (() => {
  let activeRules = [];
  let removedElements = new Map(); // ruleId -> [{ element, parent, nextSibling, display }]
  let observer = null;
  let styleElement = null;

  // ── Built-in static rules — no API needed ─────────────────
  // These catch obvious ad patterns that LinkedIn uses.
  const BUILTIN_RULES = [
    // Ad iframes
    { selector: 'iframe[data-ad-banner]', reason: 'Ad iframe (data-ad-banner)' },
    { selector: 'iframe.ad-banner', reason: 'Ad iframe (.ad-banner)' },
    { selector: 'iframe[title="advertisement"]', reason: 'Ad iframe (title=advertisement)' },
    { selector: 'iframe[title="Advertisement"]', reason: 'Ad iframe (title=Advertisement)' },
    // Promoted / Sponsored post labels and their containers
    { selector: '.feed-shared-actor__sub-description:has(span[aria-hidden="true"])', reason: 'Promoted post label container' },
    // Sponsored content wrappers
    { selector: '[data-ad-banner]', reason: 'Element with data-ad-banner attribute' },
    { selector: '[data-is-sponsored="true"]', reason: 'Sponsored content (data-is-sponsored)' },
    // Premium upsell
    { selector: '.premium-upsell-link', reason: 'Premium upsell link' },
    { selector: '.premium-upsell', reason: 'Premium upsell widget' },
    { selector: '[data-control-name="premium_upsell"]', reason: 'Premium upsell CTA' },
    { selector: '[data-control-name="try_premium"]', reason: 'Try Premium CTA' },
    // Ad banner containers
    { selector: '.ad-banner-container', reason: 'Ad banner container' },
    { selector: '.ads-container', reason: 'Ads container' },
    { selector: '[data-test-id="ad-banner"]', reason: 'Ad banner (test ID)' },
    // Right rail ads
    { selector: '.right-rail-sponsored', reason: 'Right rail sponsored' },
    { selector: '.ad-placeholder', reason: 'Ad placeholder' },
  ].map((r, i) => ({
    ...r,
    id: `builtin_${i}`,
    confidence: 1.0,
    createdBy: 'builtin',
    builtin: true,
    timestamp: 0,
    hitCount: 0,
    lastSeen: null,
    failures: 0,
    disabled: false,
  }));

  function init() {
    // Create a style element for CSS-based hiding
    styleElement = document.createElement('style');
    styleElement.id = 'linkedin-ad-remover-styles';
    document.head.appendChild(styleElement);

    // Apply built-in rules immediately — before storage even loads
    activeRules = [...BUILTIN_RULES];
    applyAllRules();

    // Start MutationObserver for SPA navigation / dynamic loads
    observer = new MutationObserver(debounce(() => {
      applyAllRules();
    }, 300));

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Then load user/claude rules from storage
    loadAndApplyRules();
  }

  async function loadAndApplyRules() {
    try {
      const storedRules = await Storage.getRules();
      // Merge: builtins first, then stored (no duplicates)
      const storedIds = new Set(storedRules.map(r => r.id));
      activeRules = [
        ...BUILTIN_RULES.filter(r => !storedIds.has(r.id)),
        ...storedRules
      ];
      applyAllRules();
    } catch (e) {
      console.warn('[AdRemover] Failed to load rules:', e);
    }
  }

  function applyAllRules() {
    let totalRemoved = 0;
    const cssSelectors = [];

    for (const rule of activeRules) {
      if (rule.disabled) continue;

      try {
        const elements = document.querySelectorAll(rule.selector);
        if (elements.length > 0) {
          elements.forEach(el => {
            if (!el.dataset.adRemoverHidden) {
              el.dataset.adRemoverHidden = rule.id;
              totalRemoved++;
            }
          });
          cssSelectors.push(rule.selector);

          // Track hit count
          rule.hitCount = (rule.hitCount || 0) + elements.length;
          rule.lastSeen = Date.now();
        }
      } catch (e) {
        console.warn(`[AdRemover] Invalid selector: ${rule.selector}`, e);
      }
    }

    // Text-based detection: find "Promoted" labels and hide their feed post ancestor
    totalRemoved += hidePromotedPosts();

    // Apply CSS hiding for all selectors at once (performant)
    if (cssSelectors.length > 0) {
      styleElement.textContent = cssSelectors
        .map(sel => `${sel} { display: none !important; }`)
        .join('\n');
    }

    return totalRemoved;
  }

  // Walk the DOM for "Promoted" / "Sponsored" text and hide the enclosing post
  function hidePromotedPosts() {
    let count = 0;
    const candidates = document.querySelectorAll(
      '.feed-shared-update-v2, .occludable-update, [data-urn*="activity"], [data-urn*="ugcPost"]'
    );

    candidates.forEach(post => {
      if (post.dataset.adRemoverHidden) return;

      // Look for the "Promoted" or "Sponsored" label inside the post
      const spans = post.querySelectorAll('span');
      for (const span of spans) {
        const text = (span.textContent || '').trim();
        if (text === 'Promoted' || text === 'Sponsored') {
          post.dataset.adRemoverHidden = 'promoted_text';
          post.style.display = 'none';
          count++;
          break;
        }
      }
    });

    return count;
  }

  function addRule(rule) {
    // Ensure rule has required fields
    const fullRule = {
      id: rule.id || generateId(),
      selector: rule.selector,
      reason: rule.reason || 'Unknown',
      confidence: rule.confidence || 0.5,
      createdBy: rule.createdBy || 'claude',
      timestamp: Date.now(),
      hitCount: 0,
      lastSeen: null,
      failures: 0,
      disabled: false
    };

    activeRules.push(fullRule);
    applyAllRules();

    // Persist
    Storage.saveRule(fullRule);

    return fullRule;
  }

  function addRules(rules) {
    const fullRules = rules.map(rule => ({
      id: rule.id || generateId(),
      selector: rule.selector,
      reason: rule.reason || 'Unknown',
      confidence: rule.confidence || 0.5,
      createdBy: rule.createdBy || 'claude',
      timestamp: Date.now(),
      hitCount: 0,
      lastSeen: null,
      failures: 0,
      disabled: false
    }));

    activeRules.push(...fullRules);
    applyAllRules();

    // Persist all at once
    Storage.saveRules(fullRules);

    return fullRules;
  }

  function removeRule(ruleId) {
    // Revert the visual change
    revertRule(ruleId);
    activeRules = activeRules.filter(r => r.id !== ruleId);
    Storage.deleteRule(ruleId);
    rebuildStyles();
  }

  function revertRule(ruleId) {
    const rule = activeRules.find(r => r.id === ruleId);
    if (!rule) return;

    try {
      const elements = document.querySelectorAll(rule.selector);
      elements.forEach(el => {
        if (el.dataset.adRemoverHidden === ruleId) {
          delete el.dataset.adRemoverHidden;
        }
      });
    } catch (e) {
      // Selector might be invalid
    }

    rule.disabled = true;
    rebuildStyles();
  }

  function revertRuleBySelector(selector) {
    const rule = activeRules.find(r => r.selector === selector);
    if (rule) {
      revertRule(rule.id);
      rule.failures = (rule.failures || 0) + 1;
      Storage.updateRule(rule.id, { disabled: true, failures: rule.failures });
    }
  }

  function rebuildStyles() {
    const cssSelectors = activeRules
      .filter(r => !r.disabled)
      .map(r => r.selector);

    if (cssSelectors.length > 0) {
      styleElement.textContent = cssSelectors
        .map(sel => `${sel} { display: none !important; }`)
        .join('\n');
    } else {
      styleElement.textContent = '';
    }
  }

  function toggleRule(ruleId) {
    const rule = activeRules.find(r => r.id === ruleId);
    if (!rule) return;

    rule.disabled = !rule.disabled;
    Storage.updateRule(ruleId, { disabled: rule.disabled });
    rebuildStyles();
    if (!rule.disabled) applyAllRules();
  }

  function getActiveRules() {
    return [...activeRules];
  }

  function getStats() {
    const nonBuiltin = activeRules.filter(r => !r.builtin);
    const enabled = nonBuiltin.filter(r => !r.disabled).length;
    const total = nonBuiltin.length;
    const userCreated = nonBuiltin.filter(r => r.createdBy === 'user').length;
    const claudeCreated = nonBuiltin.filter(r => r.createdBy === 'claude').length;
    const builtinHits = activeRules.filter(r => r.builtin && r.hitCount > 0).length;
    return { enabled, total, userCreated, claudeCreated, builtinHits };
  }

  function generateId() {
    return 'rule_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  }

  function debounce(fn, ms) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  }

  function destroy() {
    if (observer) observer.disconnect();
    if (styleElement) styleElement.remove();
    activeRules = [];
    removedElements.clear();
  }

  return {
    init, loadAndApplyRules, applyAllRules,
    addRule, addRules, removeRule, revertRule, revertRuleBySelector,
    toggleRule, getActiveRules, getStats, destroy
  };
})();

if (typeof globalThis !== 'undefined') {
  globalThis.RuleEngine = RuleEngine;
}
