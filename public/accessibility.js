(() => {
  const button = document.getElementById('fontBtn');
  const panel = document.getElementById('magnificationPanel');
  const slider = document.getElementById('magnificationRange');
  const value = document.getElementById('magnificationValue');
  const reset = document.getElementById('magnificationReset');
  if (!button || !panel || !slider || !value) return;

  const clamp = number => Math.min(160, Math.max(80, Number(number) || 100));

  function applyMagnification(percent, persist = true) {
    const safePercent = clamp(percent);
    const factor = safePercent / 100;
    slider.value = String(safePercent);
    value.textContent = `${safePercent}%`;
    button.setAttribute('aria-label', `Magnificação da tela: ${safePercent}%. Clique para ajustar.`);
    button.title = `Magnificação ${safePercent}%`;

    if (persist) localStorage.setItem('totem-magnification', String(safePercent));

    if (window.kiosk?.setZoomFactor) {
      window.kiosk.setZoomFactor(factor);
      document.documentElement.style.zoom = '';
    } else {
      // Fallback para teste em navegador comum. Chromium/Electron usa zoom nativo acima.
      document.documentElement.style.zoom = String(factor);
    }
  }

  function setPanel(open) {
    panel.hidden = !open;
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) slider.focus({ preventScroll: true });
  }

  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-controls', 'magnificationPanel');
  button.setAttribute('aria-expanded', 'false');

  button.addEventListener('click', () => setPanel(panel.hidden));
  slider.addEventListener('input', () => applyMagnification(slider.value));
  reset?.addEventListener('click', () => applyMagnification(100));

  document.addEventListener('pointerdown', event => {
    if (panel.hidden || panel.contains(event.target) || button.contains(event.target)) return;
    setPanel(false);
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !panel.hidden) setPanel(false);
  });

  applyMagnification(localStorage.getItem('totem-magnification') || 100, false);
})();
