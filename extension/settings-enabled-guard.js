(() => {
  const enabled = document.getElementById('enabled');
  if (!enabled) return;

  function ensureEnabledControlInteractive() {
    if (enabled.disabled) enabled.disabled = false;
    enabled.removeAttribute('disabled');
    enabled.closest('.check-row')?.removeAttribute('aria-disabled');
  }

  ensureEnabledControlInteractive();
  const observer = new MutationObserver(() => ensureEnabledControlInteractive());
  observer.observe(enabled, { attributes: true, attributeFilter: ['disabled'] });
  window.addEventListener('pageshow', ensureEnabledControlInteractive);
  window.addEventListener('unload', () => observer.disconnect(), { once: true });
})();
