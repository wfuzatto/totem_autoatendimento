(function () {
  function removeLegacyAlignmentPanel() {
    const legacy = document.getElementById('alignmentComparison');
    if (legacy) legacy.remove();
  }

  function safeJson(text) {
    try { return JSON.parse(text); } catch (_) { return null; }
  }

  function ensureMockWarning(result) {
    if (result?.provider !== 'mock_homologation') return;

    const details = document.getElementById('biometricDetails');
    if (details && !document.getElementById('mockHomologationWarning')) {
      const warning = document.createElement('div');
      warning.id = 'mockHomologationWarning';
      warning.className = 'secure-warning mb-3';
      warning.textContent = 'MODO DE HOMOLOGAÇÃO: resultado sintético para testar a interface. Nenhuma identidade foi comparada.';
      details.prepend(warning);
    }

    const decision = document.getElementById('faceDecision');
    if (!decision) return;
    decision.className = 'mt-4 h5 status warn';
    if (result.status === 'match') {
      decision.textContent = 'SIMULAÇÃO DE MATCH · fluxo de sucesso exercitado sem verificação real de identidade.';
    } else if (result.status === 'mismatch') {
      decision.textContent = 'SIMULAÇÃO DE MISMATCH · fluxo de rejeição exercitado sem verificação real de identidade.';
    } else if (result.status === 'review') {
      decision.textContent = 'SIMULAÇÃO DE REVIEW · fluxo de revisão exercitado sem verificação real de identidade.';
    } else {
      decision.textContent = 'SIMULAÇÃO DE HOMOLOGAÇÃO · provider sintético sem verificação real de identidade.';
    }
  }

  function updateFromResult() {
    removeLegacyAlignmentPanel();
    const payload = safeJson(document.getElementById('faceResult')?.textContent || '');
    ensureMockWarning(payload?.face_scanner || null);
  }

  function init() {
    removeLegacyAlignmentPanel();
    const faceResult = document.getElementById('faceResult');
    if (faceResult) {
      new MutationObserver(updateFromResult).observe(faceResult, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    }
    new MutationObserver(removeLegacyAlignmentPanel).observe(document.body, { childList: true, subtree: true });
    updateFromResult();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
