export const themeScript = `(() => {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  function apply() {
    let value = 'system';
    try { value = localStorage.getItem('irl-manager-theme') || 'system'; } catch {}
    if (!['dark', 'light', 'system'].includes(value)) value = 'system';
    document.documentElement.dataset.themePreference = value;
    document.documentElement.dataset.theme = value === 'system' ? (media.matches ? 'dark' : 'light') : value;
    window.dispatchEvent(new Event('irl-theme-change'));
  }
  media.addEventListener('change', apply);
  window.addEventListener('storage', apply);
  window.addEventListener('irl-theme-set', apply);
  apply();
})();`;
