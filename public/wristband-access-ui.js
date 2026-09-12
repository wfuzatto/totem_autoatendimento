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
      const active = () => !stopped && root.isConnected;
      const observer = new MutationObserver(() => { if (!root.isConnected) stop(); });
      const stop = () => { stopped = true; clearTimeout(timer); observer.disconnect(); };
      stopPrevious = stop;
      observer.observe(document.getElementById('app'), { childList: true });

      function state(name, text, retry = false, uid = '', recoverUid = '') {
        phase = name;
        retryAllowed = retry;
        recoveryUid = recoverUid;
        message.textContent = text + (uid ? ' UID: ' + uid : '');
        message.className = 'fw-bold mt-3 ' + (name === 'error' ? 'text-danger' : 'text-success');
        scan.dataset.nfcState = name;
        button.hidden = !next;
        const recoveringUncertainWrite = name === 'error' && Boolean(recoveryUid);
        button.disabled = !ready || name === 'writing' || (guard.waitingRemoval && !recoveringUncertainWrite) || (name === 'error' && !retry && !recoveringUncertainWrite);
        button.textContent = name === 'writing'
          ? 'Gravando pulseira...'
          : recoveringUncertainWrite ? 'Confirmar reemissão'
            : name === 'error' && retry ? 'Tentar novamente'
              : 'Gravar pulseira · UH ' + (context?.room_number || '—');
        if (!ready) button.textContent = 'Gravação indisponível';
        if (advance) advance.disabled = Boolean(next) || !context || !ready || guard.waitingRemoval;
      }

      async function refresh() {
        context = await json('/api/reservations/' + reservationId + '/access-context');
        status = await json('/api/access-control/status');
        if (!active()) return;
        const credentials = new Map((context.credentials || []).map(c => [c.guest_id, c.uid]));
        // Simulation and stale browser snapshots are not evidence of a real write.
        const adults = guests.filter(g => g.adult).map(g => ({ ...g, uid: credentials.get(g.id) || null }));
        next = adults.find(g => !g.uid);
        const mock = context.provider === 'mock' && status.provider === 'mock';
        ready = context.ready_for_wristband && (mock || (context.provider === 'bis_api' && status.ready_for_write === true));
        title.textContent = next ? 'Aproxime a pulseira de ' + next.name : 'Todas as pulseiras foram gravadas';
        helper.textContent = mock ? 'Teste simulado: nenhum cartão físico será gravado.' : 'Aproxime a pulseira e aguarde. A gravação começa automaticamente.';
        root.querySelector('.wristband-list').innerHTML = adults.map((g, i) => '<div class="wristband-item"><span><strong>Pulseira ' + (i + 1) + '</strong> · ' + escape(g.name) + '</span><span class="status-pill ' + (g.uid ? 'status-ok' : 'status-pending') + '">' + (g.uid ? mock ? 'Simulada' : 'Gravada' : 'Aguardando') + '</span></div>').join('');
        const blocker = context.blockers?.[0]?.message || status.error || 'Gravação indisponível.';
        panel.innerHTML = '<div class="d-flex justify-content-between flex-wrap gap-3"><strong class="fs-3">UH ' + escape(context.room_number || 'aguardando PMS') + '</strong><strong>' + escape(date(context.valid_from || context.checkin_date)) + ' → ' + escape(date(context.valid_until || context.checkout_date)) + '</strong></div><div class="mt-3">' + (mock ? 'Modo de teste simulado' : ready ? '● BIS API conectado<br>● ACS ACR122U pronto<br>● Gravação real habilitada' : escape(blocker)) + '</div>';
        panel.className = 'alert rounded-4 my-4 ' + (ready ? 'alert-success' : 'alert-danger');
        checkedAt = Date.now();
        if (!ready) state('error', blocker);
        else if (!next && !guard.waitingRemoval) state('complete', 'Todas as pulseiras foram gravadas.');
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
          state('writing', 'Confirmando a reemissão desta pulseira...');
          try {
            await json('/api/reservations/' + reservationId + '/wristbands/' + next.id + '/recover', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ expected_uid: uid })
            });
            if (!active()) return;
            flow.retry({ force: true });
            guard.waitingRemoval = true;
            guard.removalReads = 0;
            state('remove', 'Reemissão autorizada. Retire a pulseira do leitor.');
          } catch (error) {
            if (active()) state('error', error.message, false, '', uid);
          }
          return;
        }
        if (guard.waitingRemoval) return;
        if (context.provider === 'mock') {
          state('writing', 'Simulando...');
          try {
            const result = await json('/api/reservations/' + reservationId + '/wristbands/encode', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ guest_id: next.id }) });
            if (active()) await onWritten(result);
          } catch (error) { if (active()) state('error', error.message, true); }
          return;
        }
        if (phase === 'error' && retryAllowed) flow.retry();
        await flow.step();
      };

      async function tick() {
        if (!active()) return;
        try {
          if (!context || Date.now() - checkedAt > 3000) await refresh();
          if (active() && ready && context.provider === 'bis_api' && (next || guard.waitingRemoval)) await flow.step();
          if (active() && !next && ready && !guard.waitingRemoval) state('complete', 'Todas as pulseiras foram gravadas.');
        } catch (error) { ready = false; if (active()) state('error', error.message); }
        finally { if (active()) timer = setTimeout(tick, 700); }
      }
      state('checking', 'Consultando o gravador...');
      tick();
    }
  };
})();
