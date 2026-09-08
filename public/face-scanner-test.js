let reservationBundle = null;

const $ = id => document.getElementById(id);

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  let payload = null;
  try { payload = await response.json(); } catch (_) {}
  if (!response.ok) throw new Error(payload?.error || payload?.detail || `HTTP ${response.status}`);
  return payload;
}

async function refreshScannerStatus() {
  const el = $('scannerStatus');
  try {
    const status = await api('/api/face-scanner/status');
    if (status.reachable) {
      el.className = 'badge rounded-pill text-bg-success p-3';
      el.textContent = `Face Scanner ${status.health?.version || ''} pronto`;
    } else {
      el.className = 'badge rounded-pill text-bg-danger p-3';
      el.textContent = status.configured ? 'Face Scanner indisponível' : 'Face Scanner não configurado';
    }
  } catch (error) {
    el.className = 'badge rounded-pill text-bg-danger p-3';
    el.textContent = 'Face Scanner indisponível';
  }
}

function updateSelectedGuest() {
  const guestId = Number($('guestSelect').value || 0);
  const guest = reservationBundle?.guests?.find(item => Number(item.id) === guestId);
  $('expectedName').value = guest?.name || '';
  $('analyzeBtn').disabled = !guest;
}

$('lookupBtn').addEventListener('click', async () => {
  const query = $('reservationNumber').value.trim();
  if (!query) return;
  $('reservationInfo').textContent = 'Buscando reserva…';
  $('guestSelect').disabled = true;
  $('analyzeBtn').disabled = true;
  try {
    reservationBundle = await api('/api/reservations/lookup', {
      method: 'POST',
      body: JSON.stringify({ type: 'reservation', query })
    });
    const guests = reservationBundle.guests || [];
    $('guestSelect').innerHTML = guests.map(g => `<option value="${g.id}">${g.name}${g.adult ? ' · adulto' : ''}</option>`).join('');
    $('guestSelect').disabled = guests.length === 0;
    $('reservationInfo').textContent = `Reserva ${reservationBundle.reservation.reservation_number} · responsável: ${reservationBundle.reservation.responsible_name} · ${guests.length} hóspede(s)`;
    updateSelectedGuest();
  } catch (error) {
    reservationBundle = null;
    $('guestSelect').innerHTML = '<option>Reserva não carregada</option>';
    $('expectedName').value = '';
    $('reservationInfo').textContent = error.message;
  }
});

$('guestSelect').addEventListener('change', updateSelectedGuest);

$('analyzeBtn').addEventListener('click', async () => {
  const guestId = Number($('guestSelect').value || 0);
  const front = $('front').files[0];
  if (!reservationBundle || !guestId) return;
  if (!front) return alert('Selecione a foto do documento.');

  const form = new FormData();
  form.append('reservation_id', reservationBundle.reservation.id);
  form.append('guest_id', guestId);
  form.append('document_type', $('documentType').value);
  form.append('front', front);
  const back = $('back').files[0];
  if (back) form.append('back', back);

  $('decision').className = 'mt-4 h5 status muted';
  $('decision').textContent = 'Analisando documento com o nome da reserva…';
  $('result').textContent = 'Processando…';
  $('analyzeBtn').disabled = true;

  try {
    const response = await fetch('/api/face-scanner/document/analyze', { method: 'POST', body: form });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || payload.detail || `HTTP ${response.status}`);

    const result = payload.face_scanner || {};
    const validation = result.name_validation || {};
    const status = validation.status;

    if (status === 'match' && result.can_verify_face) {
      $('decision').className = 'mt-4 h5 status ok';
      $('decision').textContent = `NOME CONFERE · ${payload.totem_context.guest_name} · etapa de captura liberada pelo Face Scanner`;
    } else if (status === 'review') {
      $('decision').className = 'mt-4 h5 status warn';
      $('decision').textContent = `REVISÃO NECESSÁRIA · OCR: ${validation.extracted || 'não identificado'} · score ${validation.score ?? '-'}`;
    } else {
      $('decision').className = 'mt-4 h5 status bad';
      $('decision').textContent = `NOME NÃO CONFERE · esperado: ${payload.totem_context.guest_name} · OCR: ${validation.extracted || 'não identificado'}`;
    }

    $('result').textContent = JSON.stringify(payload, null, 2);
  } catch (error) {
    $('decision').className = 'mt-4 h5 status bad';
    $('decision').textContent = 'Falha na integração.';
    $('result').textContent = error.message;
  } finally {
    $('analyzeBtn').disabled = false;
  }
});

refreshScannerStatus();
