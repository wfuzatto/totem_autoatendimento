(() => {
  let injecting = false;

  function inject() {
    if (injecting) return;
    const body = document.getElementById('adminBody');
    if (!body || !body.children.length || body.querySelector('[data-reservations-entry]')) return;
    injecting = true;
    try {
      const section = document.createElement('div');
      section.className = 'admin-section';
      section.dataset.reservationsEntry = '1';
      section.innerHTML = `
        <h3><i class="bi bi-calendar2-check me-2"></i>Gestão de reservas</h3>
        <div class="d-flex flex-column flex-lg-row align-items-lg-center justify-content-between gap-3">
          <div>
            <div class="fw-semibold">Dashboard operacional</div>
            <div class="text-secondary">Consulte reservas integradas, crie reservas manuais para testes e prepare uma reserva novamente para o fluxo do totem.</div>
          </div>
          <button type="button" class="btn btn-primary btn-lg flex-shrink-0" id="openReservationsDashboard">
            <i class="bi bi-box-arrow-up-right me-2"></i>Abrir reservas
          </button>
        </div>`;
      body.prepend(section);
      document.getElementById('openReservationsDashboard').onclick = () => { window.location.href = '/reservas.html'; };
    } finally {
      injecting = false;
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const body = document.getElementById('adminBody');
    if (body) new MutationObserver(inject).observe(body, { childList: true });
    document.getElementById('adminModal')?.addEventListener('shown.bs.modal', inject);
  });
})();
