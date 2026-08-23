(() => {
  const button = document.getElementById('newReservation');
  const modalEl = document.getElementById('newReservationModal');
  const form = document.getElementById('newReservationForm');
  const editor = document.getElementById('guestEditor');
  if (!button || !modalEl || !form || !editor || !window.bootstrap?.Modal) return;

  const localDate = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

  function ensureDefaults() {
    const checkin = form.querySelector('[name="checkin_date"]');
    const checkout = form.querySelector('[name="checkout_date"]');
    const balance = form.querySelector('[name="balance"]');
    const proof = document.getElementById('requirePaymentProof');

    const today = new Date();
    const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    if (checkin && !checkin.value) checkin.value = localDate(today);
    if (checkout && !checkout.value) checkout.value = localDate(tomorrow);
    if (balance && !balance.value) balance.value = '0,00';
    if (proof) proof.checked = true;

    if (!editor.querySelector('.guest-row')) {
      const row = document.createElement('div');
      row.className = 'guest-row';
      row.innerHTML = `
        <div><label class="form-label">Nome completo</label><input class="form-control" data-guest-name placeholder="Nome do hóspede"></div>
        <div><label class="form-label">Documento (opcional)</label><input class="form-control" data-guest-document placeholder="CPF/RG"></div>
        <div><label class="form-label">Tipo</label><select class="form-select" data-guest-adult><option value="1" selected>Adulto</option><option value="0">Criança</option></select></div>
        <button type="button" class="btn btn-outline-danger" data-remove-guest title="Remover"><i class="bi bi-trash3"></i></button>`;
      row.querySelector('[data-remove-guest]').addEventListener('click', () => {
        if (editor.querySelectorAll('.guest-row').length > 1) row.remove();
      });
      editor.appendChild(row);
    }
  }

  modalEl.addEventListener('show.bs.modal', ensureDefaults);

  // Fallback explícito: mesmo que o handler principal de reservas.js lance uma
  // exceção antes de chamar show(), o clique continua abrindo o modal.
  button.addEventListener('click', () => {
    try {
      ensureDefaults();
      bootstrap.Modal.getOrCreateInstance(modalEl).show();
    } catch (error) {
      console.error('Falha ao abrir nova reserva manual:', error);
    }
  });
})();
