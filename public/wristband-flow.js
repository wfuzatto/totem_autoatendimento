(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.createWristbandFlow = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  return function createWristbandFlow({ readCard, encode, onWritten, onState, active, guard }) {
    let inFlight = false;
    let failed = null;
    return {
      retry({ force = false } = {}) { if (force || failed?.retryable !== false) failed = null; },
      async step() {
        if (inFlight || !active()) return;
        inFlight = true;
        let dispatched = false;
        let detectedUid = '';
        try {
          const card = await readCard();
          if (!active()) return;
          if (!card.ok) throw new Error(card.error || 'Gravação indisponível.');
          if (card.busy) { onState('busy', 'Leitor ocupado. Aguarde...'); return; }
          if (card.awaiting_removal) guard.waitingRemoval = true;
          if (card.present === false) {
            if (guard.waitingRemoval) {
              guard.removalReads = (guard.removalReads || 0) + 1;
              if (card.awaiting_removal || guard.removalReads < 2) {
                onState('remove', 'Retire a pulseira do leitor.');
                return;
              }
              guard.waitingRemoval = false;
              guard.removalReads = 0;
            }
            if (failed) onState('error', failed.message, failed.retryable !== false);
            else onState('waiting', 'Aguardando pulseira...');
            return;
          }
          guard.removalReads = 0;
          if (guard.waitingRemoval) { onState('remove', 'Retire a pulseira do leitor.'); return; }
          if (failed) {
            onState('error', failed.message, failed.retryable === true, '', failed.recoveryUid || '');
            return;
          }
          if (card.present !== true || !card.uidHex) throw new Error('Nenhuma pulseira detectada.');
          detectedUid = card.uidHex;
          onState('detected', 'Pulseira detectada.');
          guard.waitingRemoval = true;
          guard.removalReads = 0;
          dispatched = true;
          onState('writing', 'Gravando pulseira... Não retire do leitor.');
          const result = await encode(card.uidHex);
          if (!result.ok || result.provider !== 'bis_api' || !result.code || (!result.already_encoded && result.mock !== false)) {
            throw Object.assign(new Error(result.error || 'Falha ao gravar pulseira.'), { retryable: result.retryable });
          }
          onState('written', 'Pulseira gravada. Retire a pulseira.', false, result.code);
          if (active()) await onWritten(result);
        } catch (error) {
          if (!active()) return;
          if (dispatched) {
            failed = {
              message: error.message,
              retryable: error.retryable === true,
              recoveryUid: error.code === 'write_uncertain' ? detectedUid : ''
            };
          }
          onState('error', error.message, dispatched && failed?.retryable === true, '', failed?.recoveryUid || '');
        } finally { inFlight = false; }
      }
    };
  };
});
