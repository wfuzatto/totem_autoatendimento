(() => {
  const app = document.getElementById('app');
  if (!app) return;

  function enhanceGovbrIframe() {
    const frame = document.getElementById('govbrHotelFrame');
    if (!frame) return;

    const shell = frame.closest('.govbr-iframe-shell');
    if (!shell || shell.querySelector('.govbr-scroll-cue')) return;

    frame.setAttribute('scrolling', 'yes');
    frame.setAttribute('aria-describedby', 'govbrScrollInstruction');

    const cue = document.createElement('div');
    cue.className = 'govbr-scroll-cue';
    cue.setAttribute('aria-hidden', 'true');
    cue.innerHTML = `
      <div class="govbr-scroll-cue-title">ROLE</div>
      <div class="govbr-scroll-cue-track"><span class="govbr-scroll-cue-thumb"></span></div>
      <i class="bi bi-chevron-down govbr-scroll-cue-arrow"></i>`;
    shell.appendChild(cue);

    const instruction = document.createElement('div');
    instruction.id = 'govbrScrollInstruction';
    instruction.className = 'govbr-scroll-instruction';
    instruction.innerHTML = '<i class="bi bi-mouse me-2"></i><strong>Role dentro desta área</strong> para visualizar e preencher todo o conteúdo do gov.br.';
    shell.insertAdjacentElement('afterend', instruction);
  }

  const observer = new MutationObserver(() => queueMicrotask(enhanceGovbrIframe));
  observer.observe(app, { childList: true, subtree: true });
  enhanceGovbrIframe();
})();
