// content/console-monitor.js — Intercepts console errors for self-healing

const ConsoleMonitor = (() => {
  const errorBuffer = []; // Ring buffer of last 20 errors
  const MAX_ERRORS = 20;
  let originalConsoleError = null;
  let listening = false;

  function init() {
    if (listening) return;
    listening = true;

    // Override console.error
    originalConsoleError = console.error;
    console.error = function (...args) {
      captureError({
        type: 'console.error',
        message: args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '),
        source: 'console'
      });
      originalConsoleError.apply(console, args);
    };

    // Global error handler
    window.addEventListener('error', (event) => {
      captureError({
        type: 'error',
        message: event.message || 'Unknown error',
        filename: event.filename || '',
        lineno: event.lineno,
        colno: event.colno,
        source: 'window.onerror'
      });
    });

    // Unhandled promise rejections
    window.addEventListener('unhandledrejection', (event) => {
      captureError({
        type: 'unhandledrejection',
        message: event.reason?.message || String(event.reason) || 'Unhandled rejection',
        source: 'unhandledrejection'
      });
    });
  }

  function captureError(error) {
    const entry = {
      ...error,
      timestamp: Date.now(),
      isExtensionRelated: isExtensionError(error)
    };

    errorBuffer.push(entry);
    while (errorBuffer.length > MAX_ERRORS) {
      errorBuffer.shift();
    }
  }

  function isExtensionError(error) {
    const msg = (error.message || '').toLowerCase();
    const file = (error.filename || '').toLowerCase();

    // Check if error mentions our extension
    if (file.includes('chrome-extension://')) return true;
    if (msg.includes('ad-remover') || msg.includes('adremover')) return true;
    if (msg.includes('display') && msg.includes('none')) return true;

    return false;
  }

  function getRecentErrors(onlyExtension = false) {
    if (onlyExtension) {
      return errorBuffer.filter(e => e.isExtensionRelated);
    }
    return [...errorBuffer];
  }

  function getErrorsSince(timestamp) {
    return errorBuffer.filter(e => e.timestamp > timestamp);
  }

  function clear() {
    errorBuffer.length = 0;
  }

  function destroy() {
    if (originalConsoleError) {
      console.error = originalConsoleError;
      originalConsoleError = null;
    }
    listening = false;
    errorBuffer.length = 0;
  }

  return { init, getRecentErrors, getErrorsSince, clear, destroy };
})();

if (typeof globalThis !== 'undefined') {
  globalThis.ConsoleMonitor = ConsoleMonitor;
}
