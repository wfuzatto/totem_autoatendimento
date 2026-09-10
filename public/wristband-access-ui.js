(() => {
  const originalFetch = window.fetch.bind(window);
  let reservationId = null;
  let refreshTimer = null;
  let accessFetchInFlight = false;

  function captureReservationId(payload) {
    const direct = Number(payload?.reservation?.id || 0);
    const nested = Number(payload?.reservation?.reservation?.id || 0);
    const id = direct || nested;
    if (id > 0) reservationId = id;
  }

  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    try {
      const clone = response.clone();
      const type = String(clone.headers.get('content-type') || '');
      if (type.includes('application/json')) {
        const payload = await clone.json();
        captureReservationId(payload);
      }
    } catch (_) {}
    scheduleRefresh();
    return response;
  };

  function formatDate(value) {
    const raw = String(value || '').trim();
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return raw || '—';
    return `${match[3]}/${match[2]}/${match[1]}`;
  }

  function onWristbandScreen() {
    const app = document.getElementById('app');
    if (!app) return false;
    return Array.from(app.querySelectorAll('h1,h2,h3'))
      .some(node => /gr(a|á)ve as pulseiras/i.test(String(node.textContent || '')));
  }

  function ensureStyle() {
    if (document.getElementById('wristbandAccessStyle')) return;
    const style = document.createElement('style');
    style.id = 'wristbandAccessStyle';
    style.textContent = `
      .wristband-access-context{margin:18px 0 20px;border:1px solid #cfe3d5;border-radius:18px;background:#f5fbf6;padding:18px 20px;display:grid;gap:12px}
      .wristband-access-context.blocked{border-color:#efc7c7;background:#fff6f6}
      .wristband-access-head{display:flex;align-items:center;justify-content:space-between;gap:18px;flex-wrap:wrap}
      .wristband-access-room{display:flex;align-items:center;gap:12px;color:#0b5f39}
      .wristband-access-room i{font-size:1.8rem}
      .wristband-access-room strong{font-size:2rem;line-height:1}
      .wristband-access-validity{font-weight:700;color:#314b3e}
      .wristband-access-note{margin:0;color:#607066}
      .wristband-access-context.blocked .wristband-access-room,.wristband-access-context.blocked .wristband-access-validity{color:#9f2424}
      @media (max-width:720px){.wristband-access-context{padding:15px}.wristband-access-room strong{font-size:1.65rem}}
    `;
    document.head.appendChild(style);
  }

  function renderPanel(context) {
    const app = document.getElementById('app');
    const scanBox = app?.querySelector('.scan-box');
    if (!scanBox) return;

    let panel = document.getElementById('wristbandAccessContext');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'wristbandAccessContext';
      scanBox.parentNode.insertBefore(panel, scanBox);
    }

    const room = String(context?.room_number || '').trim();
    const blockers = Array.isArray(context?.blockers) ? context.blockers : [];
    const roomMissing = blockers.some(item => item?.code === 'room_missing') || !room;
    const ready = Boolean(context?.ready_for_wristband);

    panel.className = `wristband-access-context${ready ? '' : ' blocked'}`;
    panel.innerHTML = roomMissing
      ? `
        <div class="wristband-access-head">
          <div class="wristband-access-room"><i class="bi bi-door-closed"></i><div><div class="small text-uppercase fw-bold">UH</div><strong>Aguardando PMS</strong></div></div>
        </div>
        <p class="wristband-access-note"><strong>Gravação bloqueada.</strong> A reserva precisa ter uma UH atribuída pelo PMS antes de qualquer pulseira receber acesso.</p>`
      : `
        <div class="wristband-access-head">
          <div class="wristband-access-room"><i class="bi bi-door-open"></i><div><div class="small text-uppercase fw-bold">UH liberada para a pulseira</div><strong>${escapeHtml(room)}</strong></div></div>
          <div class="wristband-access-validity"><i class="bi bi-calendar-check me-2"></i>${formatDate(context.checkin_date)} → ${formatDate(context.checkout_date)}</div>
        </div>
        <p class="wristband-access-note">A pulseira será vinculada à <strong>UH ${escapeHtml(room)}</strong> e ao período desta hospedagem. O Totem não cria nem altera a UH durante a gravação.</p>`;

    const encodeButton = document.getElementById('encodeBand');
    if (encodeButton) {
      encodeButton.disabled = !ready;
      if (room && ready) encodeButton.innerHTML = `<i class="bi bi-broadcast me-2"></i>Gravar pulseira · UH ${escapeHtml(room)}`;
    }
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[char]));
  }

  async function refresh() {
    if (!onWristbandScreen() || !reservationId || accessFetchInFlight) return;
    accessFetchInFlight = true;
    try {
      const response = await originalFetch(`/api/reservations/${reservationId}/access-context`, { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Não foi possível consultar a UH da reserva.');
      ensureStyle();
      renderPanel(data);
    } catch (error) {
      ensureStyle();
      renderPanel({
        room_number: null,
        ready_for_wristband: false,
        blockers: [{ code: 'room_missing', message: error.message }]
      });
    } finally {
      accessFetchInFlight = false;
    }
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refresh, 50);
  }

  const observer = new MutationObserver(scheduleRefresh);
  const start = () => {
    const app = document.getElementById('app');
    if (app) observer.observe(app, { childList: true, subtree: true });
    scheduleRefresh();
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
