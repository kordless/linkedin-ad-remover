// summary/summary.js — Reads summary HTML from chrome.storage and displays it
(async () => {
  const loading = document.getElementById('loading');

  try {
    const { feed_summary } = await chrome.storage.local.get('feed_summary');

    if (!feed_summary) {
      loading.textContent = 'No summary found. Try running Sum from the popup.';
      return;
    }

    // Inject the summary HTML into an iframe to safely render a full HTML document
    loading.style.display = 'none';
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'width:100%;height:100vh;border:none;position:fixed;top:0;left:0;right:0;bottom:0;';
    iframe.sandbox = 'allow-same-origin';
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument || iframe.contentWindow.document;
    doc.open();
    doc.write(feed_summary);
    doc.close();
  } catch (e) {
    loading.textContent = 'Error loading summary: ' + e.message;
    console.error('[AdRemover] Summary load error:', e);
  }
})();
