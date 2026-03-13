// content/viewport.js — DOM snapshot capture for Claude analysis

const ViewportCapture = (() => {
  // Create a simplified DOM snapshot focusing on structure and ad indicators
  function captureDOMSnapshot() {
    const maxDepth = 6;
    const maxChildren = 20;

    function summarizeElement(el, depth) {
      if (depth > maxDepth) return null;
      if (!el || el.nodeType !== 1) return null;

      // Skip invisible elements
      const style = window.getComputedStyle(el);
      if (style.display === 'none' && !el.dataset.adRemoverHidden) return null;
      if (style.visibility === 'hidden') return null;

      // Skip scripts, styles, SVGs
      const tag = el.tagName.toLowerCase();
      if (['script', 'style', 'svg', 'noscript', 'link', 'meta'].includes(tag)) return null;

      const summary = { tag };

      // Capture key attributes
      if (el.id) summary.id = el.id;

      const classes = Array.from(el.classList).filter(c => c.length < 50).slice(0, 5);
      if (classes.length > 0) summary.classes = classes;

      // Capture data attributes (especially ad-related)
      for (const attr of el.attributes) {
        if (attr.name.startsWith('data-') && attr.value.length < 100) {
          if (!summary.data) summary.data = {};
          summary.data[attr.name] = attr.value;
        }
      }

      // Role and aria
      if (el.getAttribute('role')) summary.role = el.getAttribute('role');
      if (el.getAttribute('aria-label')) summary.ariaLabel = el.getAttribute('aria-label');

      // Direct text content (not children's text)
      const directText = Array.from(el.childNodes)
        .filter(n => n.nodeType === 3)
        .map(n => n.textContent.trim())
        .join(' ')
        .trim();
      if (directText && directText.length > 0 && directText.length < 200) {
        summary.text = directText;
      }

      // Check for ad indicators
      const text = (el.textContent || '').trim().toLowerCase();
      if (text.includes('promoted') || text.includes('sponsored')) {
        summary.adIndicator = true;
      }

      // Children
      const children = Array.from(el.children).slice(0, maxChildren);
      const childSummaries = children
        .map(child => summarizeElement(child, depth + 1))
        .filter(Boolean);

      if (childSummaries.length > 0) {
        summary.children = childSummaries;
      }

      return summary;
    }

    // Focus on the main content area
    const mainContent = document.querySelector('main') || document.querySelector('[role="main"]') || document.body;
    const snapshot = summarizeElement(mainContent, 0);

    // Also grab sidebar if it exists
    const sidebar = document.querySelector('aside') || document.querySelector('[data-test-id="aside"]');
    const sidebarSnapshot = sidebar ? summarizeElement(sidebar, 0) : null;

    const result = { main: snapshot };
    if (sidebarSnapshot) result.sidebar = sidebarSnapshot;

    // Stringify and truncate to avoid huge payloads
    let json = JSON.stringify(result);
    if (json.length > 15000) {
      json = json.slice(0, 15000) + '... (truncated)';
    }
    return json;
  }

  // Get viewport dimensions and scroll position
  function getViewportInfo() {
    return {
      width: window.innerWidth,
      height: window.innerHeight,
      scrollTop: window.scrollY,
      scrollLeft: window.scrollX,
      pageHeight: document.documentElement.scrollHeight,
      url: window.location.href
    };
  }

  return { captureDOMSnapshot, getViewportInfo };
})();

if (typeof globalThis !== 'undefined') {
  globalThis.ViewportCapture = ViewportCapture;
}
