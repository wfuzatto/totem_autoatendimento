(() => {
  const app = document.getElementById('app');
  if (!app) return;

  let running = false;
  let allowOriginalPay = false;

  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

  const methodInfo = method => ({
    pix: {
      label: 'PIX',
      icon: 'bi-qr-code',
      stages: [
        ['Preparando PIX de demonstração', 'Gerando uma cobrança simulada. Nenhum PIX real será criado.'],
        ['Aguardando pagamento simulado', 'Simulando a leitura e a confirmação do PIX.'],
        ['Confirmando transação', 'Validando a resposta no ambiente de demonstração.']
      ]
    },
    debit: {
      label: 'Cartão de débito',
      icon: 'bi-credit-card-2-front',
      stages: [
        ['Inicializando terminal simulado', 'Preparando a Gertec PPC930 em modo de demonstração.'],
        ['Aguardando cartão', 'Simulando aproximação, inserção e leitura do cartão de débito.'],
        ['Autorizando transação', 'Consultando o autorizador simulado. Nenhum cartão será cobrado.']
      ]
    },
    credit: {
      label: 'Cartão de crédito',
      icon: 'bi-credit-card',
      stages: [
        ['Inicializando terminal simulado', 'Preparando a Gertec PPC930 em modo de demonstração.'],
        ['Aguardando cartão', 'Simulando aproximação, inserção e leitura do cartão de crédito.'],
        ['Autorizando transação', 'Consultando o autorizador simulado. Nenhum cartão será cobrado.']
      ]
    }
  }[method] || {
    label: 'Pagamento',
    icon: 'bi-cash-coin',
    stages: [
      ['Iniciando simulação', 'Preparando o pagamento em ambiente de demonstração.'],
      ['Processando', 'Simulando a confirmação da transação.'],
      ['Autorizando', 'Validando a resposta simulada.']
    ]
  });

  function isPaymentScreen() {
    return Boolean(app.querySelector('.payment-grid') && app.querySelector('[data-action="pay"]'));
  }

  function selectedMethod() {
    return app.querySelector('.payment-option.selected')?.dataset.payment || '';
  }

  function updateSelectionHint() {
    const panel = document.getElementById('v2PaymentSimulationHint');
    const payButton = app.querySelector('[data-action="pay"]');
    if (!panel || !payButton) return;
    const method = selectedMethod();
    if (!method) {
      panel.innerHTML = '<i class="bi bi-hand-index-thumb me-2"></i>Escolha uma forma de pagamento para iniciar a simulação.';
      return;
    }
    const info = methodInfo(method);
    panel.innerHTML = `<i class="bi ${info.icon} me-2"></i><strong>${info.label} selecionado.</strong> Ao continuar, o sistema fará somente uma simulação de aprovação.`;
    payButton.innerHTML = '<i class="bi bi-play-circle me-2"></i>Simular pagamento';
  }

  function createOverlay(method) {
    document.getElementById('v2PaymentSimulationOverlay')?.remove();
    const info = methodInfo(method);
    const overlay = document.createElement('div');
    overlay.id = 'v2PaymentSimulationOverlay';
    overlay.className = 'v2-payment-overlay';
    overlay.setAttribute('role', 'status');
    overlay.setAttribute('aria-live', 'assertive');
    overlay.innerHTML = `
      <div class="v2-payment-modal">
        <div class="v2-payment-demo-badge"><i class="bi bi-cone-striped me-2"></i>AMBIENTE DE SIMULAÇÃO</div>
        <div class="v2-payment-method-icon"><i class="bi ${info.icon}"></i></div>
        <h2 id="v2PaymentStageTitle">Iniciando ${info.label}</h2>
        <p id="v2PaymentStageText">Aguarde um momento.</p>
        <div class="v2-payment-spinner" id="v2PaymentSpinner"><span class="spinner-border" aria-hidden="true"></span></div>
        <div class="v2-payment-progress"><span id="v2PaymentProgressBar"></span></div>
        <div class="v2-payment-no-charge"><i class="bi bi-shield-check me-2"></i>Nenhuma cobrança real será realizada.</div>
      </div>`;
    document.body.appendChild(overlay);
    return overlay;
  }

  function setStage(title, text, progress, approved = false) {
    const overlay = document.getElementById('v2PaymentSimulationOverlay');
    if (!overlay) return;
    const titleEl = document.getElementById('v2PaymentStageTitle');
    const textEl = document.getElementById('v2PaymentStageText');
    const bar = document.getElementById('v2PaymentProgressBar');
    const spinner = document.getElementById('v2PaymentSpinner');
    const icon = overlay.querySelector('.v2-payment-method-icon');
    if (titleEl) titleEl.textContent = title;
    if (textEl) textEl.textContent = text;
    if (bar) bar.style.width = `${progress}%`;
    if (approved) {
      overlay.classList.add('approved');
      if (spinner) spinner.innerHTML = '<i class="bi bi-check-circle-fill"></i>';
      if (icon) icon.innerHTML = '<i class="bi bi-check2"></i>';
    }
  }

  async function runSimulation(payButton) {
    if (running) return;
    const method = selectedMethod();
    if (!method) return;

    running = true;
    const info = methodInfo(method);
    const overlay = createOverlay(method);
    app.querySelectorAll('.payment-option').forEach(button => { button.disabled = true; });
    payButton.disabled = true;

    try {
      setStage(info.stages[0][0], info.stages[0][1], 18);
      await wait(900);
      setStage(info.stages[1][0], info.stages[1][1], 48);
      await wait(1250);
      setStage(info.stages[2][0], info.stages[2][1], 76);
      await wait(1050);
      setStage('Pagamento aprovado', `${info.label} aprovado no ambiente de demonstração.`, 100, true);
      await wait(1400);

      overlay.remove();
      allowOriginalPay = true;
      payButton.disabled = false;
      payButton.click();
    } catch (_) {
      overlay.remove();
      app.querySelectorAll('.payment-option').forEach(button => { button.disabled = false; });
      payButton.disabled = false;
    } finally {
      running = false;
    }
  }

  function decoratePaymentScreen() {
    if (!isPaymentScreen()) return;
    const grid = app.querySelector('.payment-grid');
    const payButton = app.querySelector('[data-action="pay"]');
    if (!grid || !payButton || grid.dataset.v2PaymentSimulator === '1') return;
    grid.dataset.v2PaymentSimulator = '1';

    const oldInfo = Array.from(app.querySelectorAll('.alert.alert-info')).find(el => /Gertec|SiTef|pagamento.+modo visual/i.test(el.textContent || ''));
    if (oldInfo) {
      oldInfo.className = 'alert alert-warning mt-4 v2-payment-demo-warning';
      oldInfo.innerHTML = '<i class="bi bi-cone-striped me-2"></i><strong>Pagamento em modo de simulação.</strong> O gateway/SiTef ainda não está configurado. Nenhum PIX ou cartão será cobrado durante os testes.';
    }

    const hint = document.createElement('div');
    hint.id = 'v2PaymentSimulationHint';
    hint.className = 'v2-payment-simulation-hint';
    hint.innerHTML = '<i class="bi bi-hand-index-thumb me-2"></i>Escolha uma forma de pagamento para iniciar a simulação.';
    grid.insertAdjacentElement('afterend', hint);

    app.querySelectorAll('.payment-option').forEach(button => {
      button.addEventListener('click', () => setTimeout(updateSelectionHint, 0));
    });

    payButton.addEventListener('click', event => {
      if (allowOriginalPay) {
        allowOriginalPay = false;
        return;
      }
      if (!selectedMethod() || running) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      runSimulation(payButton);
    }, true);
  }

  const observer = new MutationObserver(() => setTimeout(decoratePaymentScreen, 25));
  observer.observe(app, { childList: true, subtree: true });
  decoratePaymentScreen();
})();
