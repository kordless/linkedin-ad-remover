// summary/summary.js — Reads summary HTML from chrome.storage and displays it
(async () => {
  const loading = document.getElementById('loading');
  const content = document.getElementById('content');

  try {
    const { feed_summary } = await chrome.storage.local.get('feed_summary');

    if (!feed_summary) {
      loading.textContent = 'No summary found. Try running Sum from the popup.';
      return;
    }

    // Replace the entire page with the summary HTML
    document.open();
    document.write(feed_summary);
    document.close();
  } catch (e) {
    loading.textContent = 'Error loading summary: ' + e.message;
  }
})();
