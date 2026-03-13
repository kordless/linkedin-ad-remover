// content/content.js — Main content script: ctrl-click handler, orchestration

(function () {
  'use strict';

  // Prevent double injection
  if (window.__linkedinAdRemoverLoaded) return;
  window.__linkedinAdRemoverLoaded = true;

  // Initialize modules
  ConsoleMonitor.init();
  RuleEngine.init();

  let extensionEnabled = true;
  let wideFeedStyleEl = null;

  const WIDE_FEED_CSS = `
    .scaffold-layout__sidebar { display: none !important; }
    .scaffold-layout__aside,
    aside.scaffold-layout__aside,
    .scaffold-layout__aside--right { display: none !important; }
    .scaffold-layout__main {
      max-width: 900px !important;
      width: 100% !important;
      flex: 1 1 100% !important;
      margin: 0 auto !important;
    }
    .scaffold-layout__content,
    .scaffold-layout__content--main-aside {
      max-width: 100% !important;
      width: 100% !important;
      justify-content: center !important;
    }
    .scaffold-layout__inner {
      max-width: 1200px !important;
      width: 100% !important;
      margin: 0 auto !important;
    }
    .scaffold-layout__row {
      max-width: 100% !important;
      width: 100% !important;
      justify-content: center !important;
    }
  `;

  function setWideFeed(enabled) {
    if (enabled && !wideFeedStyleEl) {
      wideFeedStyleEl = document.createElement('style');
      wideFeedStyleEl.id = 'linkedin-ad-remover-wide-feed';
      wideFeedStyleEl.textContent = WIDE_FEED_CSS;
      document.head.appendChild(wideFeedStyleEl);
    } else if (!enabled && wideFeedStyleEl) {
      wideFeedStyleEl.remove();
      wideFeedStyleEl = null;
    }
  }

  // Load settings
  Storage.getSettings().then(settings => {
    extensionEnabled = settings.enabled;
    if (settings.wideFeed) setWideFeed(true);
    if (extensionEnabled && settings.autoScanOnLoad) {
      // Notify background to start scan after page settles
      setTimeout(() => {
        chrome.runtime.sendMessage({ type: 'PAGE_READY', url: window.location.href });
      }, 2500);
    }
  });

  // ── Ctrl+Click Handler ──────────────────────────────────────
  // Use mousedown instead of click — Chrome intercepts ctrl+click
  // on links to open in a new tab before the click event fires.
  let suppressNextClick = false;

  document.addEventListener('mousedown', (event) => {
    if (!event.ctrlKey || event.button !== 0 || !extensionEnabled) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    suppressNextClick = true;

    const target = findBestTarget(event.target);
    if (!target) return;

    // Visual feedback: flash outline
    flashElement(target);

    // Gather element context
    const context = SelectorUtils.getElementContext(target);

    // Show toast
    showToast('Element marked — Claude is learning...');

    // Send to background for Claude analysis
    chrome.runtime.sendMessage({
      type: 'USER_SELECTED_ELEMENT',
      elementContext: context
    });
  }, true);

  // Block the click that follows a ctrl+mousedown so the link doesn't navigate
  document.addEventListener('click', (event) => {
    if (suppressNextClick) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      suppressNextClick = false;
    }
  }, true);

  // Walk up the DOM to find the best container to remove
  // (user might click on text inside an ad — we want the whole ad container)
  function findBestTarget(element) {
    let current = element;
    let depth = 0;
    const maxDepth = 8;

    while (current && current !== document.body && depth < maxDepth) {
      // Check if this looks like a feed item / card container
      const tag = current.tagName.toLowerCase();
      const classes = current.className || '';
      const role = current.getAttribute('role') || '';

      if (
        // Common LinkedIn card/post containers
        classes.includes('feed-shared-update') ||
        classes.includes('occludable-update') ||
        classes.includes('ad-banner') ||
        classes.includes('artdeco-card') ||
        current.getAttribute('data-urn') ||
        current.getAttribute('data-id') ||
        role === 'article' ||
        role === 'listitem' ||
        // Generic container signals
        (tag === 'section' && depth > 1) ||
        (tag === 'aside' && depth > 1) ||
        (tag === 'div' && current.children.length > 3 && depth > 2)
      ) {
        return current;
      }

      current = current.parentElement;
      depth++;
    }

    // Fallback: return the clicked element
    return element;
  }

  // ── Toast Notification ──────────────────────────────────────
  function showToast(message, duration = 3000) {
    const existing = document.getElementById('ad-remover-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'ad-remover-toast';
    toast.textContent = message;
    Object.assign(toast.style, {
      position: 'fixed',
      bottom: '20px',
      right: '20px',
      background: '#1a1a2e',
      color: '#e0e0e0',
      padding: '12px 20px',
      borderRadius: '8px',
      fontSize: '14px',
      fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
      zIndex: '999999',
      boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
      transition: 'opacity 0.3s',
      opacity: '0'
    });

    document.body.appendChild(toast);
    requestAnimationFrame(() => { toast.style.opacity = '1'; });

    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  // ── Visual Feedback ─────────────────────────────────────────
  function flashElement(element) {
    const original = element.style.outline;
    element.style.outline = '3px solid #e74c3c';
    element.style.outlineOffset = '-3px';

    setTimeout(() => {
      element.style.outline = '3px solid transparent';
      setTimeout(() => {
        element.style.outline = original;
        element.style.outlineOffset = '';
      }, 200);
    }, 400);
  }

  // ── Message Listener (from background) ──────────────────────
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
      case 'APPLY_RULES': {
        const added = RuleEngine.addRules(message.rules);
        const stats = RuleEngine.getStats();
        showToast(`Removed ${added.length} ad element(s)`);
        sendResponse({ success: true, stats });
        break;
      }

      case 'APPLY_SINGLE_RULE': {
        const rule = RuleEngine.addRule(message.rule);
        showToast(`Rule learned: ${message.rule.reason}`);
        sendResponse({ success: true, rule });
        break;
      }

      case 'REVERT_RULES': {
        for (const selector of message.selectors) {
          RuleEngine.revertRuleBySelector(selector);
        }
        showToast(`Reverted ${message.selectors.length} rule(s) — self-healed`);
        sendResponse({ success: true });
        break;
      }

      case 'CAPTURE_VIEWPORT': {
        const snapshot = ViewportCapture.captureDOMSnapshot();
        const viewport = ViewportCapture.getViewportInfo();
        sendResponse({ snapshot, viewport });
        break;
      }

      case 'GET_ERRORS': {
        const errors = ConsoleMonitor.getErrorsSince(message.since || 0);
        sendResponse({ errors });
        break;
      }

      case 'GET_STATS': {
        const stats = RuleEngine.getStats();
        sendResponse({ stats });
        break;
      }

      case 'TOGGLE_EXTENSION': {
        extensionEnabled = message.enabled;
        if (!extensionEnabled) {
          RuleEngine.destroy();
          showToast('Ad Remover disabled');
        } else {
          RuleEngine.init();
          showToast('Ad Remover enabled');
        }
        sendResponse({ success: true });
        break;
      }

      case 'RESCAN': {
        chrome.runtime.sendMessage({ type: 'PAGE_READY', url: window.location.href });
        showToast('Re-scanning page...');
        sendResponse({ success: true });
        break;
      }

      case 'REMOVE_RULE': {
        RuleEngine.removeRule(message.ruleId);
        showToast('Rule removed — element restored');
        sendResponse({ success: true });
        break;
      }

      case 'CLEAR_ALL_RULES': {
        RuleEngine.destroy();
        RuleEngine.init();
        showToast('All rules cleared');
        sendResponse({ success: true });
        break;
      }

      case 'TOGGLE_WIDE_FEED': {
        setWideFeed(message.wideFeed);
        showToast(message.wideFeed ? 'Wide feed enabled' : 'Wide feed disabled');
        sendResponse({ success: true });
        break;
      }

      case 'SCROLL_DOWN': {
        window.scrollBy(0, window.innerHeight * 0.85);
        // Wait for content to load
        setTimeout(() => {
          sendResponse({
            scrollY: window.scrollY,
            atBottom: (window.innerHeight + window.scrollY) >= (document.body.scrollHeight - 100)
          });
        }, 800);
        return true; // async
      }

      case 'SCROLL_TO_TOP': {
        window.scrollTo(0, 0);
        sendResponse({ success: true });
        break;
      }

      case 'GET_VISIBLE_POSTS': {
        const posts = getVisiblePostData();
        sendResponse({ posts });
        break;
      }
    }

    return true; // Keep message channel open for async responses
  });

  // ── Post Data Extraction ─────────────────────────────────────
  function getVisiblePostData() {
    const posts = [];
    const seen = new Set();
    const candidates = document.querySelectorAll(
      '.feed-shared-update-v2, .occludable-update, [data-urn*="activity"], [data-urn*="ugcPost"]'
    );

    candidates.forEach(post => {
      // Skip hidden/removed posts
      if (post.style.display === 'none' || post.dataset.adRemoverHidden) return;

      const text = (post.textContent || '').trim().slice(0, 1000);
      if (!text || text.length < 20) return;

      // Deduplicate by first 100 chars
      const key = text.slice(0, 100);
      if (seen.has(key)) return;
      seen.add(key);

      // Extract author
      const authorEl = post.querySelector(
        '.feed-shared-actor__name, .update-components-actor__name'
      );
      const author = authorEl ? authorEl.textContent.trim() : '';

      // Extract links
      const links = [];
      post.querySelectorAll('a[href]').forEach(a => {
        const href = a.href;
        if (href && !href.includes('javascript:') && !href.startsWith('#')) {
          const linkText = (a.textContent || '').trim().slice(0, 100);
          if (href.includes('linkedin.com/posts/') ||
              href.includes('linkedin.com/pulse/') ||
              href.includes('linkedin.com/feed/update/') ||
              (!href.includes('linkedin.com') && href.startsWith('http'))) {
            links.push({ href, text: linkText });
          }
        }
      });

      // Extract engagement
      const likeEl = post.querySelector('.social-details-social-counts__reactions-count');
      const commentEl = post.querySelector('.social-details-social-counts__comments');
      const likes = likeEl ? likeEl.textContent.trim() : '';
      const comments = commentEl ? commentEl.textContent.trim() : '';

      posts.push({
        author,
        text: text.slice(0, 800),
        links: links.slice(0, 5),
        likes,
        comments
      });
    });

    return posts;
  }

  // ── SPA Navigation Detection ────────────────────────────────
  let lastUrl = window.location.href;

  const urlObserver = new MutationObserver(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      // Page navigated within LinkedIn SPA
      setTimeout(() => {
        RuleEngine.applyAllRules();
        if (extensionEnabled) {
          chrome.runtime.sendMessage({ type: 'PAGE_READY', url: lastUrl });
        }
      }, 2000);
    }
  });

  urlObserver.observe(document.body, { childList: true, subtree: true });

  console.log('[AdRemover] LinkedIn Ad Remover initialized');
})();
