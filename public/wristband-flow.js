(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.createWristbandFlow = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  return function createWristbandFlow({ readCard, encode, onWritten, onState, active, guard }) {
    let inFlight = false;
    let failed = null;
    const requiresCardReplacement = error => /BIS código 5|código deste hotel|código 5/i.test(String(error?.message || ''));

    async function confirmRemoval(firstRead) {
      if (firstRead.present !== false) return false;
      if (!firstRead.awaiting_removal) return true;

      // O backend exige duas leituras consecutivas sem cartão para diferenciar
      // uma retirada real de uma oscilação momentânea do PC/SC. Fazemos essa
      // segunda confirmação somente dentro da ação manual do usuário, nunca em loop.
      const confirmation = await readCard();
      if (!active()) return false;
      return confirmation.present === false && confirmation.awaiting_removal !== true;
    }

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
              onState('remove', 'Confirmando que a pulseira anterior foi retirada...');
              const removed = await confirmRemoval(card);
              if (!removed) {
                onState('remove', 'Retire completamente a pulseira do leitor e confirme novamente.');
                return;
              }
              guard.waitingRemoval = false;
              guard.removalReads = 0;
              if (failed) onState('error', failed.message, failed.retryable !== false);
              else onState('waiting', 'Pulseira anterior retirada. Aproxime a próxima e toque em gravar.');
              return;
            }
            if (failed) onState('error', failed.message, failed.retryable !== false);
            else onState('waiting', 'Nenhuma pulseira detectada. Aproxime uma pulseira e toque em gravar.');
            return;
          }

          guard.removalReads = 0;
          if (guard.waitingRemoval) {
            onState('remove', 'Retire a pulseira anterior do leitor antes de continuar.');
            return;
          }

          if (failed) {
            // Código 5 do BIS é uma rejeição determinística da autenticação do
            // cartão. Repetir o MESMO UID não pode resolver. Uma pulseira
            // fisicamente diferente libera uma única nova tentativa manual.
            if (failed.rejectedUid && card.uidHex && card.uidHex !== failed.rejectedUid) {
              failed = null;
            } else {
              onState('error', failed.message, failed.retryable === true, '', failed.recoveryUid || '');
              return;
            }
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
            const replaceCard = requiresCardReplacement(error);
            failed = {
              message: error.message,
              retryable: replaceCard ? false : error.retryable === true,
              recoveryUid: error.code === 'write_uncertain' ? detectedUid : '',
              rejectedUid: replaceCard ? detectedUid : ''
            };
          }
          onState('error', error.message, dispatched && failed?.retryable === true, '', failed?.recoveryUid || '');
        } finally { inFlight = false; }
      }
    };
  };
});
