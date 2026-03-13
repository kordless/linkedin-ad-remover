// lib/claude-client.js — Claude API wrapper (text + vision)

const ClaudeClient = (() => {
  const API_URL = 'https://api.anthropic.com/v1/messages';
  const MODEL = 'claude-sonnet-4-20250514';
  const MAX_TOKENS = 4096;

  const SYSTEM_PROMPT = `You are an expert at identifying advertisements, sponsored content, and promotional elements on LinkedIn pages. Your job is to analyze LinkedIn page content (screenshots and/or DOM snapshots) and return CSS selectors that target ad/promotional elements for removal.

Key patterns to look for:
- Posts labeled "Promoted" or "Sponsored"
- "LinkedIn Premium" upsell banners and cards
- "Try Premium" calls to action
- Sidebar ads and promotional cards
- "People also viewed" sections that are actually ads
- Job recommendation ads disguised as content
- "Boost this post" prompts
- Newsletter promotion banners
- LinkedIn Learning promotions
- "Grow your career" promotional widgets
- Any element with ad-tracking data attributes

Rules for CSS selectors:
- Prefer data attributes (data-urn, data-id, data-control-name) over class names when possible
- Use class-based selectors when data attributes aren't available, but avoid clearly auto-generated/hashed class names
- Selectors should be specific enough to avoid false positives but general enough to catch variants
- Test your selectors mentally: would this also catch non-ad content?

IMPORTANT: Always respond with valid JSON. No markdown, no code fences.`;

  let totalTokensUsed = 0;

  async function makeRequest(apiKey, messages, options = {}) {
    const body = {
      model: MODEL,
      max_tokens: options.maxTokens || MAX_TOKENS,
      system: SYSTEM_PROMPT + (options.contextMemory ? `\n\nPrevious learnings about LinkedIn ad patterns:\n${options.contextMemory}` : ''),
      messages
    };

    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Claude API error ${response.status}: ${error}`);
    }

    const data = await response.json();
    totalTokensUsed += (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0);

    return {
      content: data.content[0]?.text || '',
      usage: data.usage,
      totalTokensUsed
    };
  }

  // Analyze a viewport screenshot + DOM snapshot for ads
  async function analyzeViewport(apiKey, screenshot, domSnapshot, contextMemory) {
    const content = [];

    if (screenshot) {
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: screenshot
        }
      });
    }

    content.push({
      type: 'text',
      text: `Analyze this LinkedIn page and identify all advertisements, sponsored content, promotional elements, and upsell widgets. Return a JSON array of objects, each with:
- "selector": a CSS selector targeting the ad element
- "reason": why this is an ad/promotional content (be specific)
- "confidence": number 0-1, how confident you are this is an ad

DOM snapshot (simplified):
${domSnapshot || 'Not available'}

Respond ONLY with a JSON array. Example:
[{"selector": ".ad-banner-container", "reason": "LinkedIn Premium upsell banner", "confidence": 0.95}]

If no ads are found, return an empty array: []`
    });

    const result = await makeRequest(apiKey, [{ role: 'user', content }], { contextMemory });

    try {
      const text = result.content.trim();
      const parsed = JSON.parse(text);
      return { rules: parsed, usage: result.usage, totalTokensUsed: result.totalTokensUsed };
    } catch {
      // Try to extract JSON from the response
      const match = result.content.match(/\[[\s\S]*\]/);
      if (match) {
        return { rules: JSON.parse(match[0]), usage: result.usage, totalTokensUsed: result.totalTokensUsed };
      }
      return { rules: [], usage: result.usage, totalTokensUsed: result.totalTokensUsed };
    }
  }

  // Generalize a user-selected element into a robust rule
  async function generalizeSelector(apiKey, elementContext, contextMemory) {
    const content = [{
      type: 'text',
      text: `A user ctrl-clicked an element on LinkedIn to mark it as an ad. Analyze this element and create a generalized CSS selector that would catch this and similar ad elements.

Element details:
- Current selector: ${elementContext.selector}
- Tag: ${elementContext.tagName}
- Classes: ${elementContext.classes.join(', ')}
- Text content: ${elementContext.text}
- Ad indicators found: ${elementContext.adIndicators.join(', ') || 'none'}
- HTML snippet: ${elementContext.snippet}

Return a JSON object with:
- "selector": a generalized CSS selector (catches similar elements, not just this exact one)
- "reason": why this is likely an ad
- "confidence": number 0-1

Respond ONLY with a JSON object.`
    }];

    const result = await makeRequest(apiKey, [{ role: 'user', content }], { contextMemory });

    try {
      const text = result.content.trim();
      const parsed = JSON.parse(text);
      return { rule: parsed, usage: result.usage, totalTokensUsed: result.totalTokensUsed };
    } catch {
      const match = result.content.match(/\{[\s\S]*\}/);
      if (match) {
        return { rule: JSON.parse(match[0]), usage: result.usage, totalTokensUsed: result.totalTokensUsed };
      }
      throw new Error('Failed to parse Claude response for selector generalization');
    }
  }

  // Self-healing check: did we break anything?
  async function checkForBreakage(apiKey, screenshot, appliedRules, errors) {
    const content = [];

    if (screenshot) {
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: screenshot
        }
      });
    }

    content.push({
      type: 'text',
      text: `I just applied these ad-removal rules on LinkedIn:
${JSON.stringify(appliedRules, null, 2)}

${errors.length > 0 ? `These JavaScript errors occurred after applying the rules:\n${errors.map(e => `- ${e.message} (${e.source})`).join('\n')}` : 'No JavaScript errors occurred.'}

Look at the page screenshot. Does the page look broken? Are there:
- Large blank/white gaps where content should be?
- Broken layout (elements overlapping, misaligned)?
- Missing essential LinkedIn UI elements (navigation, profile, messaging)?
- Signs that non-ad content was accidentally removed?

Respond with a JSON object:
{
  "broken": true/false,
  "issues": ["description of each issue"],
  "revert": ["selector1", "selector2"] (selectors to revert, empty if no issues)
}

Respond ONLY with JSON.`
    });

    const result = await makeRequest(apiKey, [{ role: 'user', content }]);

    try {
      const text = result.content.trim();
      return JSON.parse(text);
    } catch {
      const match = result.content.match(/\{[\s\S]*\}/);
      if (match) return JSON.parse(match[0]);
      return { broken: false, issues: [], revert: [] };
    }
  }

  // Update context memory with learned patterns
  async function updateContextMemory(apiKey, currentMemory, newRules) {
    const content = [{
      type: 'text',
      text: `You maintain a concise summary of LinkedIn ad patterns you've learned. Update the summary below with new findings. Keep it under 500 words — focus on CSS selector patterns and element characteristics that reliably identify ads.

Current summary:
${currentMemory || 'No previous learnings.'}

New rules just created:
${JSON.stringify(newRules, null, 2)}

Return ONLY the updated summary text (plain text, not JSON).`
    }];

    const result = await makeRequest(apiKey, [{ role: 'user', content }], { maxTokens: 1024 });
    return result.content.trim();
  }

  function getTokensUsed() {
    return totalTokensUsed;
  }

  function estimateCost() {
    // Rough estimate: ~$3 per 1M input tokens, ~$15 per 1M output tokens for Sonnet
    // Simplified estimate using blended rate
    return (totalTokensUsed / 1_000_000) * 5;
  }

  return {
    analyzeViewport,
    generalizeSelector,
    checkForBreakage,
    updateContextMemory,
    getTokensUsed,
    estimateCost
  };
})();
