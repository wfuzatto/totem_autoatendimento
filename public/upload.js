(() => {
  const content = document.getElementById('content');
  const token = new URLSearchParams(location.search).get('token');
  const esc = v => String(v ?? '').replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c]));
  let flash = null;

  async function req(url, options={}) {
    const res = await fetch(url, options);
    let data={}; try{data=await res.json();}catch(_){}
    if(!res.ok) throw new Error(data.error || 'Não foi possível concluir a solicitação.');
    return data;
  }

  const guestName = (data, id) => data.guests.find(g => g.id === id)?.name || 'Reserva';

  function statusInfo(doc) {
    if (doc.status === 'received') return { cls:'ok', icon:'bi-check-circle-fill', text: doc.type === 'identity' ? 'Validado' : 'Enviado' };
    if (doc.status === 'invalid') return { cls:'invalid', icon:'bi-x-circle-fill', text:'Documento inválido' };
    if (doc.status === 'validation_error') return { cls:'invalid', icon:'bi-exclamation-triangle-fill', text:'Falha na validação' };
    if (doc.status === 'validating') return { cls:'pending', icon:'bi-hourglass-split', text:'Validando' };
    return { cls:'pending', icon:'bi-clock', text:'Pendente' };
  }

  function guidance(doc) {
    if (doc.type !== 'identity') return '';
    if (doc.status === 'invalid') {
      return '<div class="alert alert-danger py-2 px-3 mt-2 mb-2"><strong>Documento inválido.</strong> Envie novamente uma CNH ou RG/CIN com CPF visível e todos os dados legíveis.</div>';
    }
    if (doc.status === 'validation_error') {
      return '<div class="alert alert-warning py-2 px-3 mt-2 mb-2">Não foi possível executar a validação automática. Tente enviar novamente. Se persistir, procure um atendente.</div>';
    }
    if (doc.status !== 'received') {
      return '<div class="validation-help mt-2 mb-2"><i class="bi bi-shield-check me-1"></i><strong>Aceitos:</strong> CNH ou RG/CIN com CPF visível. Fotografe o documento inteiro, sem cortes, reflexos ou desfoque.</div>';
    }
    return '<div class="validation-help valid mt-2"><i class="bi bi-check-circle-fill me-1"></i>Documento reconhecido e validado automaticamente.</div>';
  }

  async function render() {
    if(!token) return error('QR Code inválido.');
    try {
      const data = await req(`/api/public/upload/${encodeURIComponent(token)}`);
      const allDone = data.documents.every(d => d.status === 'received');
      const flashHtml = flash ? `<div class="alert alert-${flash.kind} mb-3">${esc(flash.text)}</div>` : '';
      flash = null;

      content.innerHTML = `
        ${flashHtml}
        <div class="mb-4"><div class="text-secondary">Reserva</div><div class="h4 fw-bold">${esc(data.reservation.reservation_number)} · ${esc(data.reservation.responsible_name)}</div></div>
        ${data.documents.map(doc => {
          const status = statusInfo(doc);
          return `<div class="doc">
            <div class="d-flex justify-content-between gap-2 align-items-start mb-2">
              <div><strong>${doc.type === 'identity' ? 'Documento de identidade' : 'Comprovante de pagamento'}</strong><div class="text-secondary small">${esc(guestName(data, doc.guest_id))}</div></div>
              <div class="status ${status.cls}"><i class="bi ${status.icon} me-1"></i>${status.text}</div>
            </div>
            ${guidance(doc)}
            ${doc.status !== 'received' ? `<form data-doc="${doc.id}" data-type="${doc.type}"><input class="form-control mb-2" type="file" name="file" accept="application/pdf,image/jpeg,image/png,image/webp" required><button class="btn btn-primary w-100" type="submit"><i class="bi bi-upload me-2"></i>${doc.status === 'invalid' || doc.status === 'validation_error' ? 'Enviar novamente' : 'Enviar documento'}</button></form>` : ''}
          </div>`;
        }).join('')}
        <button class="btn ${allDone ? 'btn-success':'btn-secondary'} w-100 mt-3" id="doneBtn" ${allDone ? '':'disabled'}><i class="bi bi-check2-all me-2"></i>Enviei tudo</button>
        <div id="msg" class="mt-3 text-center"></div>`;

      content.querySelectorAll('form[data-doc]').forEach(form => form.addEventListener('submit', async e => {
        e.preventDefault();
        const btn = form.querySelector('button');
        btn.disabled = true;
        btn.innerHTML = form.dataset.type === 'identity'
          ? '<span class="spinner-border spinner-border-sm me-2"></span>Enviando e validando...'
          : '<span class="spinner-border spinner-border-sm me-2"></span>Enviando...';
        try {
          const result = await req(`/api/public/upload/${encodeURIComponent(token)}/${form.dataset.doc}`, { method:'POST', body:new FormData(form) });
          flash = {
            kind: result.accepted ? 'success' : (result.status === 'validation_error' ? 'warning' : 'danger'),
            text: result.message || (result.accepted ? 'Documento recebido.' : 'Documento inválido. Envie novamente.')
          };
          await render();
        } catch(err) {
          btn.disabled=false;
          btn.textContent='Tentar novamente';
          document.getElementById('msg').innerHTML=`<div class="alert alert-danger">${esc(err.message)}</div>`;
        }
      }));

      document.getElementById('doneBtn').onclick = () => {
        document.getElementById('msg').innerHTML='<div class="alert alert-success"><strong>Pronto!</strong> Todos os documentos foram aceitos. Volte ao totem; ele será atualizado automaticamente.</div>';
      };
    } catch(err) { error(err.message); }
  }

  function error(message){ content.innerHTML=`<div class="alert alert-danger mb-0"><strong>Não foi possível abrir o envio.</strong><br>${esc(message)}</div>`; }
  render();
})();
