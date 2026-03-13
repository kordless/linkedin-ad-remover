// lib/selector-utils.js — CSS selector generation from DOM elements

const SelectorUtils = (() => {
  // Attributes to prefer when building selectors (LinkedIn-stable)
  const STABLE_ATTRS = [
    'data-urn', 'data-id', 'data-control-name',
    'data-entity-urn', 'data-test-id', 'data-tracking-control-name',
    'role', 'aria-label', 'type'
  ];

  // Classes that look auto-generated / fragile
  const FRAGILE_CLASS_RE = /^[a-z]{1,3}[0-9]+|^_|^css-|^artdeco-.*__\d/;

  function generateSelector(element) {
    // Try ID first
    if (element.id) {
      return `#${CSS.escape(element.id)}`;
    }

    // Try stable data attributes
    for (const attr of STABLE_ATTRS) {
      const val = element.getAttribute(attr);
      if (val) {
        const sel = `${element.tagName.toLowerCase()}[${attr}="${CSS.escape(val)}"]`;
        if (document.querySelectorAll(sel).length <= 3) {
          return sel;
        }
      }
    }

    // Try meaningful class names
    const classes = Array.from(element.classList).filter(c => !FRAGILE_CLASS_RE.test(c));
    if (classes.length > 0) {
      const classSelector = element.tagName.toLowerCase() + '.' + classes.map(c => CSS.escape(c)).join('.');
      if (document.querySelectorAll(classSelector).length <= 10) {
        return classSelector;
      }
    }

    // Build a path walking up the DOM
    return buildPathSelector(element);
  }

  function buildPathSelector(element, maxDepth = 4) {
    const parts = [];
    let current = element;
    let depth = 0;

    while (current && current !== document.body && depth < maxDepth) {
      let part = current.tagName.toLowerCase();

      // Add stable attribute if available
      for (const attr of STABLE_ATTRS) {
        const val = current.getAttribute(attr);
        if (val) {
          part += `[${attr}="${CSS.escape(val)}"]`;
          parts.unshift(part);
          const fullSelector = parts.join(' > ');
          if (document.querySelectorAll(fullSelector).length <= 3) {
            return fullSelector;
          }
          break;
        }
      }

      // Add meaningful classes
      const classes = Array.from(current.classList || []).filter(c => !FRAGILE_CLASS_RE.test(c));
      if (classes.length > 0) {
        part += '.' + classes.slice(0, 2).map(c => CSS.escape(c)).join('.');
      }

      // Add nth-child if needed for disambiguation
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(
          s => s.tagName === current.tagName
        );
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          part += `:nth-of-type(${index})`;
        }
      }

      parts.unshift(part);
      current = current.parentElement;
      depth++;
    }

    return parts.join(' > ');
  }

  function getElementContext(element) {
    // Get a snippet of the element and its surroundings
    const html = element.outerHTML;
    const snippet = html.length > 500 ? html.slice(0, 500) + '...' : html;

    // Collect text content
    const text = (element.textContent || '').trim().slice(0, 200);

    // Check for ad indicators
    const adIndicators = [];
    if (text.toLowerCase().includes('promoted')) adIndicators.push('contains "Promoted"');
    if (text.toLowerCase().includes('sponsored')) adIndicators.push('contains "Sponsored"');
    if (text.toLowerCase().includes('ad ') || text.toLowerCase().includes(' ad')) adIndicators.push('contains "Ad"');
    if (element.querySelector('[data-ad-banner]')) adIndicators.push('has data-ad-banner');
    if (element.closest('[data-is-sponsored]')) adIndicators.push('is sponsored content');

    return {
      selector: generateSelector(element),
      tagName: element.tagName.toLowerCase(),
      classes: Array.from(element.classList),
      snippet,
      text,
      adIndicators,
      rect: element.getBoundingClientRect()
    };
  }

  function testSelector(selector) {
    try {
      const matches = document.querySelectorAll(selector);
      return {
        valid: true,
        matchCount: matches.length,
        elements: Array.from(matches).slice(0, 5).map(el => ({
          tagName: el.tagName.toLowerCase(),
          text: (el.textContent || '').trim().slice(0, 100)
        }))
      };
    } catch {
      return { valid: false, matchCount: 0, elements: [] };
    }
  }

  return { generateSelector, buildPathSelector, getElementContext, testSelector };
})();

if (typeof globalThis !== 'undefined') {
  globalThis.SelectorUtils = SelectorUtils;
}
