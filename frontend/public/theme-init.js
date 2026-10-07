// Runs before React to avoid a flash of the wrong theme.
(function () {
  try {
    var pref = localStorage.getItem('skr-theme') || 'SYSTEM';
    var dark = pref === 'DARK' || (pref === 'SYSTEM' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (dark) document.documentElement.classList.add('dark');
  } catch (e) {
    /* storage unavailable — fall back to light */
  }
})();
