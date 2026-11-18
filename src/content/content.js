(() => {
  if (globalThis.__SIDELYRIC_CONTENT__) return;
  globalThis.__SIDELYRIC_CONTENT__ = true;
  const DEBUG = false;
  import(chrome.runtime.getURL('src/content/content-app.js')).then(module => module.start()).catch(error => {
    globalThis.__SIDELYRIC_CONTENT__ = false;
    if (DEBUG) console.debug('[SideLyric]', error);
  });
})();
