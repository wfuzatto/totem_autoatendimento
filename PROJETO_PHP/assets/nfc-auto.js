/* Autoemissão de pulseiras via BisApi/PCSC. Mantém uma pulseira bloqueada até ela ser retirada. */
(() => {
  const base = window.TOTEM_BASE || '';
  const state = { enabled: false, uid: null, waitingRemoval: false, busy: false, blocked: false, timer: null, hadButton: false, busySince: 0 };
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const request = async action => {
    const r = await fetch(`${base}/api.php?action=${encodeURIComponent(action)}`, { cache: 'no-store' });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error || `Erro ${r.status}`);
    return body;
  };
  const title = text => { const el = document.querySelector('#encodeBand')?.closest('.scan-box')?.querySelector('h2'); if (el) el.textContent = text; };
  const note = text => { const el = document.querySelector('#encodeBand')?.closest('.scan-box')?.querySelector('p'); if (el) el.textContent = text; };
  async function poll() {
    if (!state.enabled || !document.getElementById('encodeBand')) return;
    try {
      const card = await request('wristband_reader_status');
      if (!card.present) {
        if (state.waitingRemoval) { state.uid = null; state.waitingRemoval = false; state.blocked = false; }
        if (!state.busy) { title('Aguardando pulseira…'); note('Aproxime a pulseira do ACS ACR122U.'); }
      } else if (!state.uid && !state.busy && !state.blocked) {
        state.uid = card.uid || 'present'; state.busy = true; state.busySince = Date.now();
        title('Gravando pulseira…'); note('Mantenha a pulseira sobre o leitor.');
        document.getElementById('encodeBand').click();
      } else if (state.waitingRemoval) {
        title('Retire a pulseira'); note('Aproxime a próxima somente após retirar esta pulseira.');
      }
      if (state.busy && Date.now() - state.busySince > 20000) { state.busy = false; state.blocked = true; window.dispatchEvent(new Event('totem:wristband-error')); }
    } catch (error) {
      if (!state.busy) note(error.message || 'Leitor aguardando pulseira.');
    }
  }
  async function run() {
    if (state.timer || !state.enabled) return;
    while (state.enabled && document.getElementById('encodeBand')) { await poll(); await sleep(700); }
    state.timer = null;
  }
  async function init() {
    try { state.enabled = (await request('config')).nfc_mode === 'pcsc'; } catch { state.enabled = false; }
    if (!state.enabled) return;
    const activate = () => {
      const button = document.getElementById('encodeBand');
      if (button) { state.hadButton = true; button.style.display = 'none'; run(); }
      else if (state.busy && state.hadButton) {
        state.busy = false; state.waitingRemoval = true; state.hadButton = false;
        window.dispatchEvent(new Event('totem:wristband-written'));
      }
    };
    new MutationObserver(activate).observe(document.body, { childList: true, subtree: true });
    activate();
  }
  window.addEventListener('totem:wristband-written', () => { state.busy = false; state.waitingRemoval = true; state.blocked = false; });
  window.addEventListener('totem:wristband-error', () => { state.busy = false; state.blocked = true; title('Retire a pulseira e tente novamente'); note('A gravação falhou. A operação foi bloqueada para evitar repetição.'); });
  init();
})();
