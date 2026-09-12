(() => {
  const originalFetch = window.fetch.bind(window);
  let reservationId = null;
  let refreshTimer = null;
  let accessFetchInFlight = false;
  let encodingInProgress = false;
  let lastHardwareStatus = null;
  let cardPollTimer = null;
  let cardFetchInFlight = false;
  let awaitingRemoval = false;
  let detectedUid = '';

  function requestUrl(input) {
    if (typeof input === 'string') return input;
    if (input && typeof input.url === 'string') return input.url;
    return '';
  }

  function captureReservationId(payload) {
    const direct = Number(payload?.reservation?.id || 0);
    const nested = Number(payload?.reservation?.reservation?.id || 0);
    const id = direct || nested;
    if (id > 0) reservationId = id;
  }

  window.fetch = async (...args) => {
    const url = requestUrl(args[0]);
    const isEncode = /\/api\/reservations\/\d+\/wristbands\/encode(?:\?|$)/.test(url);
    if (isEncode) {
      encodingInProgress = true;
      updateEncodeButton();
    }
    try {
      const response = await originalFetch(...args);
      try {
        const clone = response.clone();
        const type = String(clone.headers.get('content-type') || '');
        if (type.includes('application/json')) {
          const payload = await clone.json();
          captureReservationId(payload);
          if (isEncode && response.ok && payload?.ok && !payload?.already_encoded) {
            awaitingRemoval = true;
            detectedUid = '';
            showFlowMessage('Pulseira gravada. Retire-a do leitor para continuar.');
          }
        }
      } catch (_) {}
      return response;
    } finally {
      if (isEncode) encodingInProgress = false;
      scheduleRefresh(60);
      updateEncodeButton();
    }
  };

  function formatDate(value) {
    const raw = String(value || '').trim();
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return raw || '—';
    return `${match[3]}/${match[2]}/${match[1]}`;
  }

  function formatDateTime(value) {
    const raw = String(value || '').trim();
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    if (!match) return formatDate(raw);
    return `${match[3]}/${match[2]}/${match[1]} ${match[4]}:${match[5]}`;
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
      .wristband-device-state{display:flex;align-items:center;gap:9px;font-weight:700;font-size:.95rem}
      .wristband-device-dot{width:11px;height:11px;border-radius:50%;background:#9aa4a0;box-shadow:0 0 0 4px rgba(120,130,125,.12)}
      .wristband-device-state.ok{color:#0b6b3d}.wristband-device-state.ok .wristband-device-dot{background:#16a05d;box-shadow:0 0 0 4px rgba(22,160,93,.14)}
      .wristband-device-state.error{color:#a12626}.wristband-device-state.error .wristband-device-dot{background:#c63737;box-shadow:0 0 0 4px rgba(198,55,55,.12)}
      @media (max-width:720px){.wristband-access-context{padding:15px}.wristband-access-room strong{font-size:1.65rem}}
    `;
    document.head.appendChild(style);
  }

  function hardwareReady(context, status) {
    if (context?.provider !== 'bis_api') return true;
    return Boolean(
      status?.online &&
      status?.codec_present &&
      status?.pcsc_shim_present &&
      status?.writes_enabled &&
      status?.hotel_password_configured &&
      status?.reader_present
    );
  }

  function hardwareLabel(context, status) {
    if (context?.provider !== 'bis_api') return 'Modo de gravação simulado';
    if (!status) return 'Consultando BIS API...';
    if (!status.online) return `BIS API indisponível${status.error ? ` · ${status.error}` : ''}`;
    if (!status.codec_present) return 'BIS API online · btlock57L.dll ausente';
    if (!status.pcsc_shim_present) return 'BIS API online · bridge ACR122U ausente';
    if (!status.writes_enabled) return 'BIS API online · emissão de cartões desabilitada';
    if (!status.hotel_password_configured) return 'BIS API online · HPASS não configurado';
    return `BIS API online · ACR122U pronto${status.reader ? ` · ${status.reader}` : ''}`;
  }

  function updateEncodeButton(context = window.__TOTEM_ACCESS_CONTEXT, status = lastHardwareStatus) {
    const encodeButton = document.getElementById('encodeBand');
    if (!encodeButton || !context) return;
    const room = String(context?.room_number || '').trim();
    const ready = Boolean(context?.ready_for_wristband) && hardwareReady(context, status);
    encodeButton.disabled = !ready || encodingInProgress;
    if (encodingInProgress) {
      encodeButton.innerHTML = '<span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Gravando no ACR122U...';
    } else if (room && ready) {
      encodeButton.innerHTML = `<i class="bi bi-broadcast me-2"></i>Gravar pulseira · UH ${escapeHtml(room)}`;
    }
  }

  function showFlowMessage(message, isError = false) {
    const scanBox = document.querySelector('.scan-box');
    if (!scanBox) return;
    let node = scanBox.querySelector('.wristband-auto-message');
    if (!node) {
      node = document.createElement('div');
      node.className = 'wristband-auto-message mt-3';
      scanBox.appendChild(node);
    }
    node.className = `wristband-auto-message mt-3 ${isError ? 'text-danger' : 'text-secondary'}`;
    node.textContent = message;
  }

  function renderPanel(context, status) {
    const app = document.getElementById('app');
    const scanBox = app?.querySelector('.scan-box');
    if (!scanBox) return;

    window.__TOTEM_ACCESS_CONTEXT = context;
    lastHardwareStatus = status;

    const room = String(context?.room_number || '').trim();
    const blockers = Array.isArray(context?.blockers) ? context.blockers : [];
    const roomMissing = blockers.some(item => item?.code === 'room_missing') || !room;
    const deviceReady = hardwareReady(context, status);
    const ready = Boolean(context?.ready_for_wristband) && deviceReady;
    const validFrom = context?.valid_from || context?.checkin_date;
    const validUntil = context?.valid_until || context?.checkout_date;
    const deviceLabel = hardwareLabel(context, status);
    const signature = JSON.stringify({
      room,
      ready,
      validFrom: validFrom || '',
      validUntil: validUntil || '',
      provider: context?.provider || '',
      deviceLabel,
      blockers: blockers.map(item => item?.code || '')
    });

    let panel = document.getElementById('wristbandAccessContext');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'wristbandAccessContext';
      scanBox.parentNode.insertBefore(panel, scanBox);
    }

    if (panel.dataset.signature !== signature) {
      panel.dataset.signature = signature;
      panel.className = `wristband-access-context${ready ? '' : ' blocked'}`;
      const deviceClass = deviceReady ? 'ok' : (context?.provider === 'bis_api' && status ? 'error' : '');
      panel.innerHTML = roomMissing
        ? `
          <div class="wristband-access-head">
            <div class="wristband-access-room"><i class="bi bi-door-closed"></i><div><div class="small text-uppercase fw-bold">UH</div><strong>Aguardando PMS</strong></div></div>
          </div>
          <p class="wristband-access-note"><strong>Gravação bloqueada.</strong> A reserva precisa ter uma UH atribuída pelo PMS antes de qualquer pulseira receber acesso.</p>`
        : `
          <div class="wristband-access-head">
            <div class="wristband-access-room"><i class="bi bi-door-open"></i><div><div class="small text-uppercase fw-bold">UH liberada para a pulseira</div><strong>${escapeHtml(room)}</strong></div></div>
            <div class="wristband-access-validity"><i class="bi bi-calendar-check me-2"></i>${formatDateTime(validFrom)} → ${formatDateTime(validUntil)}</div>
          </div>
          <div class="wristband-device-state ${deviceClass}"><span class="wristband-device-dot"></span>${escapeHtml(deviceLabel)}</div>
          <p class="wristband-access-note">A pulseira será gravada para a <strong>UH ${escapeHtml(room)}</strong> e para este período de hospedagem. O Totem só confirma a etapa depois que o <strong>bis_api</strong> retornar a gravação real com sucesso.</p>`;
    }

    const helper = scanBox.querySelector('p.text-secondary');
    if (helper && context?.provider === 'bis_api') helper.textContent = 'Leitor/gravador: ACS ACR122U · codec BIS/Be-Tech.';
    updateEncodeButton(context, status);
    if (context?.provider === 'bis_api' && ready) showFlowMessage(awaitingRemoval ? 'Aguardando retirada da pulseira...' : 'Aguardando pulseira...');
    else if (context?.provider === 'bis_api') showFlowMessage(deviceLabel, true);
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[char]));
  }

  async function refresh() {
    if (!onWristbandScreen() || !reservationId || accessFetchInFlight || encodingInProgress) return;
    accessFetchInFlight = true;
    try {
      const response = await originalFetch(`/api/reservations/${reservationId}/access-context`, { cache: 'no-store' });
      const context = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(context.error || 'Não foi possível consultar a UH da reserva.');
      let status = null;
      if (context.provider === 'bis_api') {
        const statusResponse = await originalFetch('/api/access-control/status', { cache: 'no-store' });
        status = await statusResponse.json().catch(() => ({ online: false, error: 'Resposta inválida do status do BIS API.' }));
      }
      ensureStyle();
      renderPanel(context, status);
    } catch (error) {
      ensureStyle();
      renderPanel({
        room_number: null,
        ready_for_wristband: false,
        provider: 'bis_api',
        blockers: [{ code: 'access_context_error', message: error.message }]
      }, { online: false, error: error.message });
    } finally {
      accessFetchInFlight = false;
      if (onWristbandScreen()) scheduleRefresh(2500);
    }
  }

  async function pollCard() {
    if (!onWristbandScreen() || !reservationId || cardFetchInFlight) return;
    const context = window.__TOTEM_ACCESS_CONTEXT;
    if (!context || context.provider !== 'bis_api' || !hardwareReady(context, lastHardwareStatus)) return;
    cardFetchInFlight = true;
    try {
      const response = await originalFetch('/api/access-control/card-status', { cache: 'no-store' });
      const card = await response.json().catch(() => ({}));
      if (!response.ok || card.ok === false) {
        showFlowMessage(card.error || 'Não foi possível consultar o ACR122U.', true);
        return;
      }
      if (!card.present) {
        if (awaitingRemoval) {
          awaitingRemoval = false;
          detectedUid = '';
          showFlowMessage('Aguardando pulseira...');
          scheduleRefresh(80);
        }
        return;
      }
      const uid = String(card.uidHex || '').toUpperCase();
      if (awaitingRemoval) {
        showFlowMessage('Aguardando retirada da pulseira...');
        return;
      }
      const button = document.getElementById('encodeBand');
      if (button && !button.disabled && !encodingInProgress && uid && uid !== detectedUid) {
        detectedUid = uid;
        showFlowMessage('Pulseira detectada. Gravando...');
        button.click();
      }
    } catch (error) {
      showFlowMessage(error.message || 'Não foi possível consultar o ACR122U.', true);
    } finally {
      cardFetchInFlight = false;
    }
  }

  function scheduleRefresh(delay = 80) {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refresh, delay);
  }

  function scheduleCardPoll(delay = 700) {
    clearTimeout(cardPollTimer);
    cardPollTimer = setTimeout(async () => {
      await pollCard();
      if (onWristbandScreen()) scheduleCardPoll(700);
    }, delay);
  }

  const observer = new MutationObserver(() => scheduleRefresh(80));
  const start = () => {
    const app = document.getElementById('app');
    if (app) observer.observe(app, { childList: true, subtree: true });
    scheduleRefresh(80);
    scheduleCardPoll(500);
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
