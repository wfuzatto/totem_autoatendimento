(() => {
  let stopPrevious = () => {};
  const guard = { waitingRemoval: false };
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const date = value => String(value || '').slice(0, 10).split('-').reverse().join('/');

  async function json(url, options = {}) {
    const response = await fetch(url, { cache: 'no-store', ...options });
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(result.error || 'Gravação indisponível.'), { retryable: result.retryable, code: result.code });
    return result;
  }

  window.TotemWristbands = {
    mount({ reservationId, guests, onWritten }) {
      stopPrevious();
      const root = document.querySelector('#app .panel-card');
      const scan = root.querySelector('.scan-box');
      const button = root.querySelector('#encodeBand');
      const advance = root.querySelector('[data-action="bands-encoded"]');
      const title = scan.querySelector('h2');
      const helper = scan.querySelector('p');
      const panel = document.createElement('div');
      panel.id = 'wristbandAccessContext';
      scan.before(panel);
      const message = document.createElement('p');
      message.setAttribute('role', 'status');
      message.setAttribute('aria-live', 'polite');
      scan.append(message);
      let stopped = false;
      let timer;
      let next = null;
      let context = null;
      let status = null;
      let checkedAt = 0;
      let ready = false;
      let phase = 'checking';
      let retryAllowed = false;
      let recoveryUid = '';
      let reviewPending = false;
      let replacementRequired = false;
      const active = () => !stopped && root.isConnected;
      const observer = new MutationObserver(() => { if (!root.isConnected) stop(); });
      const stop = () => { stopped = true; clearTimeout(timer); observer.disconnect(); };
      stopPrevious = stop;
      observer.observe(document.getElementById('app'), { childList: true });

      function state(name, text, retry = false, uid = '', recoverUid = '') {
        phase = name;
        retryAllowed = retry;
        recoveryUid = recoverUid;
        const rejectedByHotel = name === 'error' && /BIS código 5|código deste hotel|código 5/i.test(String(text || ''));
        replacementRequired = rejectedByHotel;
        message.textContent = text + (uid ? ' UID: ' + uid : '');
        message.className = 'fw-bold mt-3 ' + (name === 'error' ? 'text-danger' : 'text-success');
        scan.dataset.nfcState = rejectedByHotel ? 'replace-card' : name;

        const recoveringUncertainWrite = name === 'error' && Boolean(recoveryUid);
        const manualRetry = name === 'error' && retry && !rejectedByHotel;
        const mockAction = context?.provider === 'mock' && Boolean(next);
        const manualAction = Boolean(next) && (recoveringUncertainWrite || manualRetry || mockAction);
        button.hidden = !manualAction;
        button.disabled = !ready || name === 'writing';
        button.textContent = recoveringUncertainWrite
          ? 'Conferir pulseira'
          : manualRetry ? 'Tentar novamente'
            : mockAction ? 'Simular gravação'
              : 'Aguarde...';

        if (rejectedByHotel) {
          helper.textContent = guard.waitingRemoval
            ? 'Retire completamente esta pulseira do leitor. O sistema está aguardando a retirada antes de aceitar outra.'
            : 'Aproxime outra pulseira preparada para esta unidade. Ela será detectada e processada automaticamente.';
        }
        if (name === 'remove') {
          helper.textContent = 'Retire completamente a pulseira do leitor. O sistema está aguardando a retirada e só então liberará a próxima.';
        }
        if (name === 'waiting' && !replacementRequired && context?.provider === 'bis_api') {
          helper.textContent = 'Aproxime a pulseira do leitor. A detecção, a gravação e a confirmação acontecem automaticamente.';
        }
        if (advance) advance.disabled = Boolean(next) || !context || !ready || guard.waitingRemoval;
      }

      async function refresh() {
        context = await json('/api/reservations/' + reservationId + '/access-context');
        status = await json('/api/access-control/status');
        if (!active()) return;
        const credentials = new Map((context.credentials || []).map(c => [c.guest_id, c]));
        // Simulation and stale browser snapshots are not evidence of a real write.
        const adults = guests.filter(g => g.adult).map(g => {
          const credential = credentials.get(g.id) || {};
          return { ...g, uid: credential.uid || null, credentialStatus: credential.status || 'pending' };
        });
        reviewPending = adults.some(g => g.credentialStatus === 'manual_review_required');
        next = adults.find(g => !g.uid && ['pending', 'failed', 'retry_allowed', 'uncertain'].includes(g.credentialStatus));
        const mock = context.provider === 'mock' && status.provider === 'mock';
        const hasUncertain = adults.some(g => g.credentialStatus === 'uncertain');
        const readerReady = status.online === true && status.codec_present === true && status.pcsc_shim_present === true && status.reader_present === true && status.hotel_password_configured === true;
        // A prior uncertain write can be reconciled with the codec while new
        // writes are disabled; this does not make a write available.
        ready = context.ready_for_wristband && (mock || (context.provider === 'bis_api' && (status.ready_for_write === true || (hasUncertain && readerReady))));
        title.textContent = next ? 'Aproxime a pulseira de ' + next.name : reviewPending ? 'Há pulseira pendente de conferência' : 'Todas as pulseiras foram gravadas';
        helper.textContent = mock
          ? 'Teste simulado: nenhum cartão físico será gravado.'
          : hasUncertain
            ? 'Aproxime a pulseira e use a conferência segura. Nenhuma nova gravação será feita nesta etapa.'
            : guard.waitingRemoval
              ? 'Retire completamente a pulseira anterior. O sistema está aguardando a retirada.'
              : 'Aproxime a pulseira. O sistema detecta, grava uma única vez, confirma o retorno do BIS e depois aguarda a retirada.';
        root.querySelector('.wristband-list').innerHTML = adults.map((g, i) => {
          const label = g.uid ? (mock ? 'Simulada' : 'Gravada')
            : g.credentialStatus === 'uncertain' ? 'Reconciliação necessária'
              : g.credentialStatus === 'manual_review_required' ? 'Pendente de conferência'
                : g.credentialStatus === 'retry_allowed' ? 'Aguardando nova tentativa'
                  : 'Aguardando';
          return '<div class="wristband-item"><span><strong>Pulseira ' + (i + 1) + '</strong> · ' + escape(g.name) + '</span><span class="status-pill ' + (g.uid ? 'status-ok' : 'status-pending') + '">' + label + '</span></div>';
        }).join('');
        const blocker = context.blockers?.[0]?.message || status.error || 'Gravação indisponível.';
        panel.innerHTML = '<div class="d-flex justify-content-between flex-wrap gap-3"><strong class="fs-3">UH ' + escape(context.room_number || 'aguardando PMS') + '</strong><strong>' + escape(date(context.valid_from || context.checkin_date)) + ' → ' + escape(date(context.valid_until || context.checkout_date)) + '</strong></div><div class="mt-3">' + (mock ? 'Modo de teste simulado' : ready ? '● BIS API conectado<br>● ACS ACR122U pronto<br>● ' + (status.ready_for_write ? 'Gravação real habilitada' : 'Conferência somente leitura habilitada') : escape(blocker)) + '</div>';
        panel.className = 'alert rounded-4 my-4 ' + (ready ? 'alert-success' : 'alert-danger');
        checkedAt = Date.now();
        if (!ready) state('error', blocker);
        else if (!next && !guard.waitingRemoval) state(reviewPending ? 'error' : 'complete', reviewPending ? 'Uma pulseira exige conferência. As demais podem continuar.' : 'Todas as pulseiras foram gravadas.');
        else if (guard.waitingRemoval && phase !== 'error') state('remove', 'Gravação encerrada. Retire a pulseira do leitor.');
        else if (phase === 'checking') state('waiting', 'Aguardando pulseira...');
      }

      const flow = window.createWristbandFlow({
        active,
        guard,
        readCard: () => json('/api/access-control/card-status'),
        encode: uid => json('/api/reservations/' + reservationId + '/wristbands/encode', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ guest_id: next.id, expected_uid: uid })
        }),
        onWritten,
        onState: state
      });

      button.onclick = async () => {
        if (!ready || !next) return;
        if (phase === 'error' && recoveryUid) {
          const uid = recoveryUid;
          state('writing', 'Conferindo esta pulseira sem gravar...');
          try {
            const reconciled = await json('/api/reservations/' + reservationId + '/wristbands/' + next.id + '/reconcile', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ expected_uid: uid })
            });
            if (!active()) return;
            await refresh();
            if (reconciled.outcome !== 'written_reconciled' && reconciled.outcome !== 'retry_allowed') {
              state('error', reconciled.instruction || 'Pulseira pendente de conferência. A fila pode continuar.', false);
              return;
            }
            flow.retry({ force: true });
            guard.waitingRemoval = true;
            guard.removalReads = 0;
            state('remove', 'Reemissão autorizada. Retire a pulseira do leitor.');
          } catch (error) {
            if (active()) state('error', error.message, false, '', uid);
          }
          return;
        }
        if (context.provider === 'mock') {
          state('writing', 'Simulando...');
          try {
            const result = await json('/api/reservations/' + reservationId + '/wristbands/encode', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ guest_id: next.id }) });
            if (active()) await onWritten(result);
          } catch (error) { if (active()) state('error', error.message, true); }
          return;
        }
        if (phase === 'error' && retryAllowed) {
          flow.retry();
          state('waiting', 'Nova tentativa autorizada. Aguardando pulseira...');
        }
      };

      async function tick() {
        if (!active()) return;
        try {
          if (!context || Date.now() - checkedAt > 3000) await refresh();

          // Fluxo automático, mas com escrita one-shot por apresentação física:
          // 1) espera/detecta a pulseira; 2) grava uma vez; 3) aguarda a retirada;
          // 4) somente depois libera a próxima. Erros de reemissão incerta e
          // retries genéricos continuam exigindo ação explícita do operador.
          const canAutoProbe = active()
            && ready
            && context?.provider === 'bis_api'
            && !recoveryUid
            && (guard.waitingRemoval || (next && (phase !== 'error' || replacementRequired)));

          if (canAutoProbe) await flow.step();
          if (active() && !next && ready && !guard.waitingRemoval) {
            state(reviewPending ? 'error' : 'complete', reviewPending ? 'Uma pulseira exige conferência. As demais podem continuar.' : 'Todas as pulseiras foram gravadas.');
          }
        } catch (error) {
          ready = false;
          if (active()) state('error', error.message);
        } finally {
          if (active()) timer = setTimeout(tick, 1200);
        }
      }

      state('checking', 'Consultando o gravador...');
      tick();
    }
  };
})();
