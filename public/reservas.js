(() => {
  const TOKEN_KEY = 'totem-admin-token';
  let token = sessionStorage.getItem(TOKEN_KEY) || '';
  let currentReservation = null;
  let guestSequence = 0;
  let searchTimer = null;

  const loginScreen = document.getElementById('loginScreen');
  const dashboard = document.getElementById('dashboard');
  const newModal = new bootstrap.Modal(document.getElementById('newReservationModal'));
  const detailModal = new bootstrap.Modal(document.getElementById('reservationDetailModal'));
  const toast = new bootstrap.Toast(document.getElementById('dashboardToast'), { delay: 3500 });

  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
  const money = cents => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(cents || 0) / 100);
  const dateBR = value => {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match ? `${match[3]}/${match[2]}/${match[1]}` : (value || '—');
  };
  const dateTimeBR = value => {
    if (!value) return '—';
    const date = new Date(String(value).replace(' ', 'T'));
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('pt-BR');
  };
  const onlyDigits = value => String(value || '').replace(/\D/g, '');

  const statusInfo = {
    reserved: ['Aguardando check-in', 'status-reserved'],
    checked_in: ['Hospedado', 'status-checked_in'],
    checked_out: ['Check-out concluído', 'status-checked_out'],
    cancelled: ['Cancelada', 'status-cancelled']
  };
  const sourceInfo = {
    manual: ['Manual', 'source-manual', 'bi-pencil-square'],
    integration: ['Integração', 'source-integration', 'bi-cloud-arrow-down'],
    demo: ['Demonstração', 'source-demo', 'bi-flask']
  };

  function sourceBadge(source) {
    const info = sourceInfo[source] || ['Integração', 'source-integration', 'bi-cloud-arrow-down'];
    return `<span class="badge-source ${info[1]}"><i class="bi ${info[2]}"></i>${info[0]}</span>`;
  }

  function statusBadge(status) {
    const info = statusInfo[status] || [status || '—', 'status-reserved'];
    return `<span class="badge-status ${info[1]}">${esc(info[0])}</span>`;
  }

  function notify(message, danger = false) {
    const el = document.getElementById('dashboardToast');
    el.classList.toggle('text-bg-danger', danger);
    el.classList.toggle('text-bg-success', !danger);
    document.getElementById('dashboardToastBody').textContent = message;
    toast.show();
  }

  function showLogin(message = '') {
    token = '';
    sessionStorage.removeItem(TOKEN_KEY);
    dashboard.hidden = true;
    loginScreen.hidden = false;
    document.getElementById('loginError').textContent = message;
    setTimeout(() => document.getElementById('dashboardPassword')?.focus(), 100);
  }

  async function api(url, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (options.body && !(options.body instanceof FormData) && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    const response = await fetch(url, { ...options, headers });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) {
      showLogin('Sua sessão expirou. Entre novamente.');
      throw new Error('Sessão administrativa expirada.');
    }
    if (!response.ok) throw new Error(data.error || `Erro ${response.status}`);
    return data;
  }

  async function login() {
    const password = document.getElementById('dashboardPassword').value;
    document.getElementById('loginError').textContent = '';
    const button = document.getElementById('dashboardLogin');
    try {
      button.disabled = true;
      button.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Entrando...';
      const result = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      const data = await result.json().catch(() => ({}));
      if (!result.ok) throw new Error(data.error || 'Senha inválida.');
      token = data.token;
      sessionStorage.setItem(TOKEN_KEY, token);
      loginScreen.hidden = true;
      dashboard.hidden = false;
      document.getElementById('dashboardPassword').value = '';
      await loadReservations();
    } catch (error) {
      document.getElementById('loginError').textContent = error.message;
    } finally {
      button.disabled = false;
      button.innerHTML = '<i class="bi bi-shield-lock me-2"></i>Entrar';
    }
  }

  function renderStats(stats) {
    const cards = [
      ['total', 'Total', 'bi-calendar2-check'],
      ['reserved', 'Aguardando check-in', 'bi-hourglass-split'],
      ['checked_in', 'Hospedados', 'bi-door-open'],
      ['checked_out', 'Check-outs', 'bi-box-arrow-right'],
      ['manual', 'Manuais', 'bi-pencil-square'],
      ['integration', 'Integração', 'bi-cloud-arrow-down']
    ];
    document.getElementById('statsGrid').innerHTML = cards.map(([key, label, icon]) => `
      <div class="stat-card"><div class="stat-icon"><i class="bi ${icon}"></i></div><strong>${Number(stats[key] || 0)}</strong><span>${label}</span></div>
    `).join('');
  }

  function processHtml(row) {
    const docsOk = Number(row.document_count || 0) > 0 && Number(row.documents_received || 0) === Number(row.document_count || 0);
    const faceOk = Number(row.faces_verified || 0) >= Number(row.adults || 0) && Number(row.adults || 0) > 0;
    const bandsOk = Number(row.wristbands_encoded || 0) >= Number(row.adults || 0) && Number(row.adults || 0) > 0;
    return `<div class="process-mini">
      <span class="process-dot ${docsOk ? 'ok' : ''}" title="Documentos"><i class="bi bi-file-earmark-check"></i>${Number(row.documents_received || 0)}/${Number(row.document_count || 0)}</span>
      <span class="process-dot ${faceOk ? 'ok' : ''}" title="Validação facial"><i class="bi bi-person-bounding-box"></i>${Number(row.faces_verified || 0)}/${Number(row.adults || 0)}</span>
      <span class="process-dot ${bandsOk ? 'ok' : ''}" title="Pulseiras"><i class="bi bi-wifi"></i>${Number(row.wristbands_encoded || 0)}/${Number(row.adults || 0)}</span>
    </div>`;
  }

  function renderRows(rows) {
    const body = document.getElementById('reservationsBody');
    const empty = document.getElementById('emptyReservations');
    empty.hidden = rows.length > 0;
    body.innerHTML = rows.map(row => `
      <tr data-reservation-id="${row.id}">
        <td><span class="reservation-number">${esc(row.reservation_number)}</span><span class="reservation-sub">${sourceBadge(row.source || 'integration')}</span></td>
        <td><strong>${esc(row.responsible_name)}</strong><span class="reservation-sub">${esc(row.responsible_cpf || 'CPF não informado')}</span></td>
        <td>${dateBR(row.checkin_date)} <i class="bi bi-arrow-right-short"></i> ${dateBR(row.checkout_date)}</td>
        <td><strong>${esc(row.room_number || '—')}</strong></td>
        <td><strong>${Number(row.adults || 0) + Number(row.children || 0)}</strong><span class="reservation-sub">${Number(row.adults || 0)} adulto(s) · ${Number(row.children || 0)} criança(s)</span></td>
        <td>${processHtml(row)}</td>
        <td><strong>${money(row.balance_cents)}</strong><span class="reservation-sub">${row.payment_pending ? 'Pendente' : 'Quitado/sem saldo'}</span></td>
        <td>${statusBadge(row.status)}</td>
        <td><button class="btn btn-sm btn-outline-success" data-open-reservation="${row.id}" aria-label="Abrir reserva"><i class="bi bi-chevron-right"></i></button></td>
      </tr>
    `).join('');
    body.querySelectorAll('tr[data-reservation-id]').forEach(row => row.addEventListener('click', event => {
      if (event.target.closest('button')) return;
      openReservation(Number(row.dataset.reservationId));
    }));
    body.querySelectorAll('[data-open-reservation]').forEach(button => button.onclick = () => openReservation(Number(button.dataset.openReservation)));
  }

  async function loadReservations() {
    const params = new URLSearchParams();
    const search = document.getElementById('reservationSearch')?.value.trim();
    const status = document.getElementById('statusFilter')?.value;
    const source = document.getElementById('sourceFilter')?.value;
    if (search) params.set('search', search);
    if (status) params.set('status', status);
    if (source) params.set('source', source);
    const body = document.getElementById('reservationsBody');
    body.innerHTML = '<tr><td colspan="9" class="text-center py-5"><span class="spinner-border text-success"></span><div class="mt-2 text-secondary">Carregando reservas...</div></td></tr>';
    try {
      const data = await api(`/api/admin/reservations?${params}`);
      renderStats(data.stats || {});
      renderRows(data.rows || []);
    } catch (error) {
      if (token) notify(error.message, true);
    }
  }

  function addGuestRow({ name = '', document = '', adult = true } = {}) {
    guestSequence += 1;
    const row = document.createElement('div');
    row.className = 'guest-row';
    row.dataset.guestEditorId = String(guestSequence);
    row.innerHTML = `
      <div><label class="form-label">Nome completo</label><input class="form-control" data-guest-name value="${esc(name)}" placeholder="Nome do hóspede"></div>
      <div><label class="form-label">Documento (opcional)</label><input class="form-control" data-guest-document value="${esc(document)}" placeholder="CPF/RG"></div>
      <div><label class="form-label">Tipo</label><select class="form-select" data-guest-adult><option value="1" ${adult ? 'selected' : ''}>Adulto</option><option value="0" ${adult ? '' : 'selected'}>Criança</option></select></div>
      <button type="button" class="btn btn-outline-danger" data-remove-guest title="Remover"><i class="bi bi-trash3"></i></button>`;
    row.querySelector('[data-remove-guest]').onclick = () => {
      const editor = document.getElementById('guestEditor');
      if (editor.children.length <= 1) return notify('A reserva precisa ter pelo menos um hóspede.', true);
      row.remove();
    };
    document.getElementById('guestEditor').appendChild(row);
  }

  function defaultDates() {
    const today = new Date();
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
    const local = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    return [local(today), local(tomorrow)];
  }

  function openNewReservation() {
    const form = document.getElementById('newReservationForm');
    form.reset();
    const [checkin, checkout] = defaultDates();
    form.elements.checkin_date.value = checkin;
    form.elements.checkout_date.value = checkout;
    form.elements.balance.value = '0,00';
    document.getElementById('requirePaymentProof').checked = true;
    document.getElementById('guestEditor').innerHTML = '';
    addGuestRow({ adult: true });
    document.getElementById('createReservationError').hidden = true;
    newModal.show();
  }

  function parseMoneyToCents(value) {
    let raw = String(value || '').trim().replace(/R\$/gi, '').replace(/\s/g, '');
    if (!raw) return 0;
    if (raw.includes(',')) raw = raw.replace(/\./g, '').replace(',', '.');
    const number = Number(raw);
    return Number.isFinite(number) ? Math.max(0, Math.round(number * 100)) : 0;
  }

  async function createReservation() {
    const form = document.getElementById('newReservationForm');
    const errorBox = document.getElementById('createReservationError');
    errorBox.hidden = true;
    const guests = [...document.querySelectorAll('#guestEditor .guest-row')].map(row => ({
      name: row.querySelector('[data-guest-name]').value.trim(),
      document: row.querySelector('[data-guest-document]').value.trim(),
      adult: row.querySelector('[data-guest-adult]').value === '1'
    })).filter(guest => guest.name);
    const payload = {
      reservation_number: form.elements.reservation_number.value.trim(),
      responsible_name: form.elements.responsible_name.value.trim(),
      responsible_cpf: form.elements.responsible_cpf.value,
      responsible_email: form.elements.responsible_email.value.trim(),
      responsible_phone: form.elements.responsible_phone.value.trim(),
      checkin_date: form.elements.checkin_date.value,
      checkout_date: form.elements.checkout_date.value,
      room_number: form.elements.room_number.value.trim(),
      balance_cents: parseMoneyToCents(form.elements.balance.value),
      payment_pending: form.elements.payment_pending.checked,
      notes: form.elements.notes.value.trim(),
      require_payment_proof: document.getElementById('requirePaymentProof').checked,
      guests
    };
    const button = document.getElementById('createReservation');
    try {
      button.disabled = true;
      button.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Criando...';
      const created = await api('/api/admin/reservations', { method: 'POST', body: JSON.stringify(payload) });
      newModal.hide();
      notify(`Reserva ${created.reservation.reservation_number} criada e disponível no totem.`);
      await loadReservations();
      await openReservation(created.reservation.id);
    } catch (error) {
      errorBox.textContent = error.message;
      errorBox.hidden = false;
    } finally {
      button.disabled = false;
      button.innerHTML = '<i class="bi bi-check2-circle me-2"></i>Criar reserva';
    }
  }

  function detailList(rows, emptyText) {
    return rows.length ? `<div class="detail-list">${rows.join('')}</div>` : `<div class="text-secondary py-4 text-center">${esc(emptyText)}</div>`;
  }

  function renderDetail(bundle) {
    currentReservation = bundle;
    const r = bundle.reservation;
    const m = bundle.meta || {};
    document.getElementById('detailTitle').textContent = `${r.reservation_number} · ${r.responsible_name}`;
    document.getElementById('detailSource').innerHTML = `${sourceBadge(m.source || 'integration')} ${statusBadge(r.status)}`;
    document.getElementById('deleteReservation').hidden = m.source !== 'manual';

    const guests = detailList(bundle.guests.map(g => `
      <div class="detail-list-row"><div><strong>${esc(g.name)}</strong><div class="secondary">${g.adult ? 'Adulto' : 'Criança'}${g.document ? ` · ${esc(g.document)}` : ''}</div></div><div class="right"><div>${g.face_verified ? '<span class="text-success"><i class="bi bi-person-check me-1"></i>Facial validado</span>' : '<span class="text-secondary">Facial pendente</span>'}</div><div class="secondary">${g.wristband_code ? `Pulseira: ${esc(g.wristband_code)}` : 'Sem pulseira gravada'}</div></div></div>
    `), 'Nenhum hóspede cadastrado.');

    const docs = detailList(bundle.documents.map(d => `
      <div class="detail-list-row"><div><strong>${d.type === 'identity' ? 'Identidade' : 'Comprovante de pagamento'}</strong><div class="secondary">${esc(d.guest_name || 'Reserva')}</div></div><div class="right"><span class="badge ${d.status === 'received' ? 'text-bg-success' : d.status === 'invalid' ? 'text-bg-danger' : 'text-bg-warning'}">${esc(d.status)}</span><div class="secondary">${d.uploaded_at ? dateTimeBR(d.uploaded_at) : 'Não enviado'}</div></div></div>
    `), 'Nenhum documento exigido.');

    const payments = detailList(bundle.payments.map(p => `
      <div class="detail-list-row"><div><strong>${money(p.amount_cents)}</strong><div class="secondary">${esc((p.method || '').toUpperCase())} · ${dateTimeBR(p.created_at)}</div></div><div class="right"><span class="badge ${p.status === 'approved' ? 'text-bg-success' : 'text-bg-secondary'}">${esc(p.status)}</span><div class="secondary">${esc(p.external_reference || '')}</div></div></div>
    `), 'Nenhum pagamento registrado.');

    const folio = detailList(bundle.folio.map(item => `
      <div class="detail-list-row"><div><strong>${esc(item.description)}</strong><div class="secondary">${esc(item.guest_name || 'Conta da reserva')} · ${dateTimeBR(item.occurred_at)}</div></div><div class="right"><strong>${money(item.amount_cents)}</strong>${item.contested ? '<div class="secondary text-danger">Contestado</div>' : ''}</div></div>
    `), 'Nenhum lançamento no extrato.');

    const bands = detailList(bundle.wristband_returns.map(item => `
      <div class="detail-list-row"><div><strong>${esc(item.code)}</strong></div><div class="right secondary">Devolvida em ${dateTimeBR(item.returned_at)}</div></div>
    `), 'Nenhuma pulseira devolvida.');

    const audits = detailList(bundle.audit.map(item => `
      <div class="detail-list-row"><div><strong class="audit-event">${esc(item.event)}</strong><div class="secondary">${esc(JSON.stringify(item.metadata || {}))}</div></div><div class="right secondary">${dateTimeBR(item.created_at)}</div></div>
    `), 'Sem eventos de auditoria.');

    document.getElementById('reservationDetailBody').innerHTML = `
      <div class="detail-summary">
        <div class="detail-box"><small>Período</small><strong>${dateBR(r.checkin_date)} → ${dateBR(r.checkout_date)}</strong></div>
        <div class="detail-box"><small>UH</small><strong>${esc(r.room_number || 'Não definida')}</strong></div>
        <div class="detail-box"><small>Hóspedes</small><strong>${r.adults} adulto(s) · ${r.children} criança(s)</strong></div>
        <div class="detail-box"><small>Saldo</small><strong>${money(r.balance_cents)} · ${r.payment_pending ? 'pendente' : 'quitado'}</strong></div>
      </div>

      <div class="form-section">
        <h3>Dados principais</h3>
        <div class="row g-3">
          <div class="col-md-6"><label class="form-label">Responsável</label><input id="editResponsibleName" class="form-control" value="${esc(r.responsible_name)}"></div>
          <div class="col-md-3"><label class="form-label">CPF</label><input id="editResponsibleCpf" class="form-control" value="${esc(r.responsible_cpf || '')}"></div>
          <div class="col-md-3"><label class="form-label">Telefone</label><input id="editResponsiblePhone" class="form-control" value="${esc(m.responsible_phone || '')}"></div>
          <div class="col-md-6"><label class="form-label">E-mail</label><input id="editResponsibleEmail" type="email" class="form-control" value="${esc(m.responsible_email || '')}"></div>
          <div class="col-md-3"><label class="form-label">Check-in</label><input id="editCheckin" type="date" class="form-control" value="${esc(r.checkin_date || '')}"></div>
          <div class="col-md-3"><label class="form-label">Check-out</label><input id="editCheckout" type="date" class="form-control" value="${esc(r.checkout_date || '')}"></div>
          <div class="col-md-3"><label class="form-label">UH</label><input id="editRoom" class="form-control" value="${esc(r.room_number || '')}"></div>
          <div class="col-md-3"><label class="form-label">Status</label><select id="editStatus" class="form-select">${Object.entries(statusInfo).map(([value, info]) => `<option value="${value}" ${r.status === value ? 'selected' : ''}>${info[0]}</option>`).join('')}</select></div>
          <div class="col-md-3"><label class="form-label">Saldo atual (R$)</label><input id="editBalance" class="form-control" value="${(Number(r.balance_cents || 0) / 100).toFixed(2).replace('.', ',')}"></div>
          <div class="col-md-3 d-flex align-items-end"><div class="form-check form-switch mb-2"><input id="editPaymentPending" class="form-check-input" type="checkbox" ${r.payment_pending ? 'checked' : ''}><label class="form-check-label" for="editPaymentPending">Pagamento pendente</label></div></div>
          <div class="col-md-6"><label class="form-label">ID externo / integração</label><input id="editExternalId" class="form-control" value="${esc(m.external_id || '')}" ${m.source === 'integration' ? '' : ''}></div>
          <div class="col-12"><label class="form-label">Observações internas</label><textarea id="editNotes" class="form-control" rows="2">${esc(m.notes || '')}</textarea></div>
        </div>
        <div class="small text-secondary mt-3">Origem: ${sourceBadge(m.source || 'integration')} · Criada em ${dateTimeBR(r.created_at)}${m.last_sync_at ? ` · Última sincronização: ${dateTimeBR(m.last_sync_at)}` : ''}</div>
      </div>

      <ul class="nav nav-tabs detail-tabs" role="tablist">
        <li class="nav-item"><button class="nav-link active" data-bs-toggle="tab" data-bs-target="#tabGuests">Hóspedes (${bundle.guests.length})</button></li>
        <li class="nav-item"><button class="nav-link" data-bs-toggle="tab" data-bs-target="#tabDocs">Documentos (${bundle.documents.length})</button></li>
        <li class="nav-item"><button class="nav-link" data-bs-toggle="tab" data-bs-target="#tabPayments">Pagamentos (${bundle.payments.length})</button></li>
        <li class="nav-item"><button class="nav-link" data-bs-toggle="tab" data-bs-target="#tabFolio">Extrato (${bundle.folio.length})</button></li>
        <li class="nav-item"><button class="nav-link" data-bs-toggle="tab" data-bs-target="#tabBands">Pulseiras (${bundle.wristband_returns.length})</button></li>
        <li class="nav-item"><button class="nav-link" data-bs-toggle="tab" data-bs-target="#tabAudit">Auditoria</button></li>
      </ul>
      <div class="tab-content detail-pane">
        <div class="tab-pane fade show active" id="tabGuests">${guests}</div>
        <div class="tab-pane fade" id="tabDocs">${docs}<div class="alert alert-light border mt-3 mb-0"><i class="bi bi-shield-check me-2"></i>gov.br: <strong>${bundle.state.govbr_verified ? 'validado' : 'pendente'}</strong></div></div>
        <div class="tab-pane fade" id="tabPayments">${payments}</div>
        <div class="tab-pane fade" id="tabFolio">${folio}</div>
        <div class="tab-pane fade" id="tabBands">${bands}</div>
        <div class="tab-pane fade" id="tabAudit">${audits}</div>
      </div>`;
  }

  async function openReservation(id) {
    try {
      document.getElementById('reservationDetailBody').innerHTML = '<div class="text-center py-5"><span class="spinner-border text-success"></span></div>';
      detailModal.show();
      const bundle = await api(`/api/admin/reservations/${id}`);
      renderDetail(bundle);
    } catch (error) {
      notify(error.message, true);
      detailModal.hide();
    }
  }

  async function saveReservation() {
    if (!currentReservation) return;
    const id = currentReservation.reservation.id;
    const payload = {
      responsible_name: document.getElementById('editResponsibleName').value.trim(),
      responsible_cpf: document.getElementById('editResponsibleCpf').value,
      responsible_phone: document.getElementById('editResponsiblePhone').value.trim(),
      responsible_email: document.getElementById('editResponsibleEmail').value.trim(),
      checkin_date: document.getElementById('editCheckin').value,
      checkout_date: document.getElementById('editCheckout').value,
      room_number: document.getElementById('editRoom').value.trim(),
      status: document.getElementById('editStatus').value,
      balance_cents: parseMoneyToCents(document.getElementById('editBalance').value),
      payment_pending: document.getElementById('editPaymentPending').checked,
      external_id: document.getElementById('editExternalId').value.trim(),
      notes: document.getElementById('editNotes').value.trim()
    };
    try {
      const bundle = await api(`/api/admin/reservations/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
      renderDetail(bundle);
      notify('Reserva atualizada.');
      await loadReservations();
    } catch (error) { notify(error.message, true); }
  }

  async function resetReservation() {
    if (!currentReservation) return;
    const r = currentReservation.reservation;
    if (!confirm(`Preparar ${r.reservation_number} novamente para o totem?\n\nIsso volta o status para aguardando check-in, zera facial, gov.br, pulseiras e pagamentos simulados. Os documentos enviados serão preservados.`)) return;
    try {
      const bundle = await api(`/api/admin/reservations/${r.id}/reset-for-totem`, { method: 'POST', body: '{}' });
      renderDetail(bundle);
      notify('Reserva preparada novamente para teste no totem.');
      await loadReservations();
    } catch (error) { notify(error.message, true); }
  }

  async function deleteReservation() {
    if (!currentReservation || currentReservation.meta.source !== 'manual') return;
    const r = currentReservation.reservation;
    if (!confirm(`Excluir definitivamente a reserva manual ${r.reservation_number}?`)) return;
    try {
      await api(`/api/admin/reservations/${r.id}`, { method: 'DELETE' });
      detailModal.hide();
      currentReservation = null;
      notify('Reserva manual excluída.');
      await loadReservations();
    } catch (error) { notify(error.message, true); }
  }

  document.getElementById('dashboardLogin').onclick = login;
  document.getElementById('dashboardPassword').addEventListener('keydown', event => { if (event.key === 'Enter') login(); });
  document.getElementById('logoutDashboard').onclick = async () => {
    try { if (token) await api('/api/admin/logout', { method: 'POST', body: '{}' }); } catch (_) {}
    showLogin();
  };
  document.getElementById('refreshReservations').onclick = loadReservations;
  document.getElementById('newReservation').onclick = openNewReservation;
  document.getElementById('addGuest').onclick = () => addGuestRow({ adult: true });
  document.getElementById('createReservation').onclick = createReservation;
  document.getElementById('saveReservation').onclick = saveReservation;
  document.getElementById('resetReservation').onclick = resetReservation;
  document.getElementById('deleteReservation').onclick = deleteReservation;
  document.getElementById('reservationSearch').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(loadReservations, 280);
  });
  document.getElementById('statusFilter').addEventListener('change', loadReservations);
  document.getElementById('sourceFilter').addEventListener('change', loadReservations);
  document.querySelector('#newReservationForm [name="responsible_name"]').addEventListener('input', event => {
    const first = document.querySelector('#guestEditor [data-guest-name]');
    if (first && (!first.dataset.userEdited || !first.value.trim())) first.value = event.target.value;
  });
  document.getElementById('guestEditor').addEventListener('input', event => {
    if (event.target.matches('[data-guest-name]')) event.target.dataset.userEdited = '1';
  });

  if (token) {
    loginScreen.hidden = true;
    dashboard.hidden = false;
    loadReservations().catch(() => {});
  } else {
    showLogin();
  }
})();
