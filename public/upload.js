(() => {
  const content = document.getElementById('content');
  const token = new URLSearchParams(location.search).get('token');
  const esc = v => String(v ?? '').replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c]));

  async function req(url, options={}) {
    const res = await fetch(url, options);
    let data={}; try{data=await res.json();}catch(_){}
    if(!res.ok) throw new Error(data.error || 'Não foi possível concluir a solicitação.');
    return data;
  }

  const guestName = (data, id) => data.guests.find(g => g.id === id)?.name || 'Reserva';

  async function render() {
    if(!token) return error('QR Code inválido.');
    try {
      const data = await req(`/api/public/upload/${encodeURIComponent(token)}`);
      const allDone = data.documents.every(d => d.status === 'received');
      content.innerHTML = `
        <div class="mb-4"><div class="text-secondary">Reserva</div><div class="h4 fw-bold">${esc(data.reservation.reservation_number)} · ${esc(data.reservation.responsible_name)}</div></div>
        ${data.documents.map(doc => `<div class="doc">
          <div class="d-flex justify-content-between gap-2 align-items-start mb-2">
            <div><strong>${doc.type === 'identity' ? 'Documento de identidade' : 'Comprovante de pagamento'}</strong><div class="text-secondary small">${esc(guestName(data, doc.guest_id))}</div></div>
            <div class="status ${doc.status === 'received' ? 'ok':'pending'}"><i class="bi ${doc.status === 'received' ? 'bi-check-circle-fill':'bi-clock'} me-1"></i>${doc.status === 'received' ? 'Enviado':'Pendente'}</div>
          </div>
          ${doc.status !== 'received' ? `<form data-doc="${doc.id}"><input class="form-control mb-2" type="file" name="file" accept="application/pdf,image/jpeg,image/png,image/webp" required><button class="btn btn-primary w-100" type="submit"><i class="bi bi-upload me-2"></i>Enviar documento</button></form>` : ''}
        </div>`).join('')}
        <button class="btn ${allDone ? 'btn-success':'btn-secondary'} w-100 mt-3" id="doneBtn" ${allDone ? '':'disabled'}><i class="bi bi-check2-all me-2"></i>Enviei tudo</button>
        <div id="msg" class="mt-3 text-center"></div>`;

      content.querySelectorAll('form[data-doc]').forEach(form => form.addEventListener('submit', async e => {
        e.preventDefault();
        const btn = form.querySelector('button');
        btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Enviando...';
        try {
          await req(`/api/public/upload/${encodeURIComponent(token)}/${form.dataset.doc}`, { method:'POST', body:new FormData(form) });
          await render();
        } catch(err) {
          btn.disabled=false; btn.textContent='Tentar novamente';
          document.getElementById('msg').innerHTML=`<div class="alert alert-danger">${esc(err.message)}</div>`;
        }
      }));

      document.getElementById('doneBtn').onclick = () => {
        document.getElementById('msg').innerHTML='<div class="alert alert-success"><strong>Pronto!</strong> Volte ao totem. Ele será atualizado automaticamente.</div>';
      };
    } catch(err) { error(err.message); }
  }

  function error(message){ content.innerHTML=`<div class="alert alert-danger mb-0"><strong>Não foi possível abrir o envio.</strong><br>${esc(message)}</div>`; }
  render();
})();
