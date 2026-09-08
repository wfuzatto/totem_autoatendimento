let reservationBundle = null;
let verificationId = null;
let cameraStream = null;
let captureInProgress = false;
let captureGuide = null;

const $ = id => document.getElementById(id);

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  let payload = null;
  try { payload = await response.json(); } catch (_) {}
  if (!response.ok) throw new Error(payload?.error || payload?.detail || `HTTP ${response.status}`);
  return payload;
}

async function refreshScannerStatus() {
  const el = $('scannerStatus');
  try {
    const status = await api('/api/face-scanner/status');
    if (status.reachable) {
      el.className = 'badge rounded-pill text-bg-success p-3';
      el.textContent = `Face Scanner ${status.health?.version || ''} pronto`;
    } else {
      el.className = 'badge rounded-pill text-bg-danger p-3';
      el.textContent = status.configured ? 'Face Scanner indisponível' : 'Face Scanner não configurado';
    }
  } catch (error) {
    el.className = 'badge rounded-pill text-bg-danger p-3';
    el.textContent = 'Face Scanner indisponível';
  }
}

function setGuideVisible(visible) {
  $('faceGuide').hidden = !visible;
  $('captureInstruction').hidden = !visible;
  $('captureMetrics').hidden = !visible;
  if (!visible) $('captureCountdown').hidden = true;
}

function initCaptureGuide() {
  if (!window.FaceCaptureGuide) return;
  captureGuide = new window.FaceCaptureGuide({
    video: $('video'),
    guide: $('faceGuide'),
    instruction: $('captureInstruction'),
    metrics: $('captureMetrics'),
    countdown: $('captureCountdown'),
    previewEndpoint: '/api/face-scanner/face/preview',
    intervalMs: 800,
    onAutoCapture: () => captureAndSend('auto')
  });
}

function resetFaceStep(message = 'Documento ainda não liberou a etapa de câmera.') {
  verificationId = null;
  stopCamera();
  $('startCameraBtn').disabled = true;
  $('captureBtn').disabled = true;
  $('faceDecision').className = 'mt-4 h5 status muted';
  $('faceDecision').textContent = message;
  $('faceResult').textContent = 'Aguardando captura ao vivo…';
  $('cameraPlaceholder').textContent = 'Valide primeiro o documento para liberar a câmera.';
}

function updateSelectedGuest() {
  const guestId = Number($('guestSelect').value || 0);
  const guest = reservationBundle?.guests?.find(item => Number(item.id) === guestId);
  $('expectedName').value = guest?.name || '';
  $('analyzeBtn').disabled = !guest;
  resetFaceStep();
}

function stopCamera() {
  captureGuide?.stop();
  setGuideVisible(false);
  captureInProgress = false;
  if (cameraStream) {
    for (const track of cameraStream.getTracks()) track.stop();
    cameraStream = null;
  }
  const video = $('video');
  video.srcObject = null;
  video.hidden = true;
  $('cameraPlaceholder').hidden = false;
  $('captureBtn').disabled = true;
  $('stopCameraBtn').disabled = true;
  $('startCameraBtn').disabled = !verificationId;
}

async function startCamera() {
  if (!verificationId) return;
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    $('secureWarning').hidden = false;
    $('faceDecision').className = 'mt-4 h5 status bad';
    $('faceDecision').textContent = 'Câmera bloqueada: use HTTPS com certificado confiável.';
    return;
  }

  $('secureWarning').hidden = true;
  stopCamera();
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'user',
        width: { ideal: 1280 },
        height: { ideal: 960 },
        frameRate: { ideal: 30 }
      },
      audio: false
    });
    const video = $('video');
    video.srcObject = cameraStream;
    await video.play();
    video.hidden = false;
    $('cameraPlaceholder').hidden = true;
    $('captureBtn').disabled = false;
    $('stopCameraBtn').disabled = false;
    $('startCameraBtn').disabled = true;
    setGuideVisible(true);
    captureGuide?.start();
    $('faceDecision').className = 'mt-4 h5 status ok';
    $('faceDecision').textContent = 'Câmera aberta. Siga as instruções; esta etapa valida a qualidade antes da verificação de identidade.';
  } catch (error) {
    $('faceDecision').className = 'mt-4 h5 status bad';
    $('faceDecision').textContent = `Não foi possível abrir a câmera: ${error.message}`;
  }
}

function reviewInstruction(result) {
  const issues = result?.quality?.issues || [];
  if (issues.includes('nenhum_rosto_detectado')) return 'Não encontrei um rosto. Posicione-se dentro da área indicada.';
  if (issues.includes('mais_de_um_rosto_detectado')) return 'Apenas uma pessoa deve aparecer na câmera.';
  if (issues.includes('rosto_muito_pequeno')) return 'Aproxime um pouco o rosto da câmera.';
  if (issues.includes('imagem_escura')) return 'Melhore a iluminação do seu rosto.';
  if (issues.includes('imagem_clara_demais')) return 'Evite luz forte diretamente no rosto.';
  if (issues.includes('imagem_desfocada')) return 'A imagem ficou sem nitidez. Fique parado por alguns instantes.';
  return result?.message || 'Ajuste a posição e tente novamente.';
}

async function captureAndSend(source = 'manual') {
  if (!verificationId || !cameraStream || captureInProgress) return;
  const video = $('video');
  if (!video.videoWidth || !video.videoHeight) {
    $('faceDecision').className = 'mt-4 h5 status warn';
    $('faceDecision').textContent = 'A câmera ainda está inicializando. Aguarde um instante.';
    return;
  }

  captureInProgress = true;
  captureGuide?.setPaused(true);
  const canvas = $('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  $('captureBtn').disabled = true;
  $('faceDecision').className = 'mt-4 h5 status muted';
  $('faceDecision').textContent = source === 'auto'
    ? 'Captura automática realizada. Validando qualidade e estado de verificação…'
    : 'Enviando captura ao Face Scanner…';
  $('faceResult').textContent = 'Processando captura…';

  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.94));
  if (!blob) {
    captureInProgress = false;
    $('captureBtn').disabled = false;
    captureGuide?.setPaused(false);
    $('faceDecision').className = 'mt-4 h5 status bad';
    $('faceDecision').textContent = 'Falha ao gerar a imagem da câmera.';
    return;
  }

  const form = new FormData();
  form.append('verification_id', verificationId);
  form.append('selfie', blob, 'live-capture.jpg');

  try {
    const response = await fetch('/api/face-scanner/face/verify', { method: 'POST', body: form });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || payload.detail || `HTTP ${response.status}`);

    const result = payload.face_scanner || {};
    const quality = result.quality || {};
    $('faceResult').textContent = JSON.stringify(payload, null, 2);

    if (result.status === 'review') {
      $('faceDecision').className = 'mt-4 h5 status warn';
      $('faceDecision').textContent = `REVISÃO NECESSÁRIA · ${reviewInstruction(result)}`;
      $('captureBtn').disabled = false;
      captureGuide?.setPaused(false);
      captureInProgress = false;
      return;
    }

    if (result.status === 'not_configured' || result.identity_verified !== true) {
      $('faceDecision').className = 'mt-4 h5 status bad';
      $('faceDecision').textContent = `CAPTURA COM QUALIDADE ${quality.acceptable ? 'APROVADA' : 'NÃO CONFIRMADA'} · IDENTIDADE NÃO VERIFICADA · provider biométrico ${result.provider || 'não configurado'}`;
      stopCamera();
      verificationId = null;
      captureInProgress = false;
      return;
    }

    if (result.status === 'mismatch') {
      $('faceDecision').className = 'mt-4 h5 status bad';
      $('faceDecision').textContent = 'IDENTIDADE NÃO CONFERE · a verificação biométrica não confirmou a pessoa capturada.';
      stopCamera();
      verificationId = null;
      captureInProgress = false;
      return;
    }

    if (result.status === 'match' && result.identity_verified === true) {
      $('faceDecision').className = 'mt-4 h5 status ok';
      $('faceDecision').textContent = 'IDENTIDADE VERIFICADA · documento e captura ao vivo confirmados pelo provider biométrico.';
      stopCamera();
      verificationId = null;
      captureInProgress = false;
      return;
    }

    $('faceDecision').className = 'mt-4 h5 status warn';
    $('faceDecision').textContent = result.message || `Resultado biométrico: ${result.status}`;
    stopCamera();
    verificationId = null;
    captureInProgress = false;
  } catch (error) {
    $('faceDecision').className = 'mt-4 h5 status bad';
    $('faceDecision').textContent = `Falha na captura: ${error.message}`;
    $('faceResult').textContent = error.message;
    $('captureBtn').disabled = false;
    captureGuide?.setPaused(false);
    captureInProgress = false;
  }
}

$('lookupBtn').addEventListener('click', async () => {
  const query = $('reservationNumber').value.trim();
  if (!query) return;
  $('reservationInfo').textContent = 'Buscando reserva…';
  $('guestSelect').disabled = true;
  $('analyzeBtn').disabled = true;
  resetFaceStep();
  try {
    reservationBundle = await api('/api/reservations/lookup', {
      method: 'POST',
      body: JSON.stringify({ type: 'reservation', query })
    });
    const guests = reservationBundle.guests || [];
    $('guestSelect').innerHTML = guests.map(g => `<option value="${g.id}">${g.name}${g.adult ? ' · adulto' : ''}</option>`).join('');
    $('guestSelect').disabled = guests.length === 0;
    $('reservationInfo').textContent = `Reserva ${reservationBundle.reservation.reservation_number} · responsável: ${reservationBundle.reservation.responsible_name} · ${guests.length} hóspede(s)`;
    updateSelectedGuest();
  } catch (error) {
    reservationBundle = null;
    $('guestSelect').innerHTML = '<option>Reserva não carregada</option>';
    $('expectedName').value = '';
    $('reservationInfo').textContent = error.message;
  }
});

$('guestSelect').addEventListener('change', updateSelectedGuest);
$('startCameraBtn').addEventListener('click', startCamera);
$('captureBtn').addEventListener('click', () => captureAndSend('manual'));
$('stopCameraBtn').addEventListener('click', stopCamera);

$('analyzeBtn').addEventListener('click', async () => {
  const guestId = Number($('guestSelect').value || 0);
  const front = $('front').files[0];
  if (!reservationBundle || !guestId) return;
  if (!front) return alert('Selecione a foto do documento.');

  resetFaceStep('Analisando o documento antes de liberar a câmera…');

  const form = new FormData();
  form.append('reservation_id', reservationBundle.reservation.id);
  form.append('guest_id', guestId);
  form.append('document_type', $('documentType').value);
  form.append('front', front);
  const back = $('back').files[0];
  if (back) form.append('back', back);

  $('decision').className = 'mt-4 h5 status muted';
  $('decision').textContent = 'Analisando documento com o nome da reserva…';
  $('result').textContent = 'Processando…';
  $('analyzeBtn').disabled = true;

  try {
    const response = await fetch('/api/face-scanner/document/analyze', { method: 'POST', body: form });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || payload.detail || `HTTP ${response.status}`);

    const result = payload.face_scanner || {};
    const validation = result.name_validation || {};
    const status = validation.status;

    if ((status === 'match' || status === 'review') && result.can_verify_face && result.verification_id) {
      verificationId = result.verification_id;
      $('decision').className = status === 'match' ? 'mt-4 h5 status ok' : 'mt-4 h5 status warn';
      $('decision').textContent = status === 'match'
        ? `NOME CONFERE · ${payload.totem_context.guest_name} · etapa de câmera liberada`
        : `REVISÃO DOCUMENTAL · OCR: ${validation.extracted || 'não identificado'} · etapa de câmera liberada para homologação`;
      $('startCameraBtn').disabled = false;
      $('faceDecision').className = 'mt-4 h5 status warn';
      $('faceDecision').textContent = 'Documento liberou a captura. A identidade só será considerada verificada se o provider biométrico retornar confirmação.';
      $('cameraPlaceholder').textContent = 'Documento aprovado. Abra a câmera para continuar.';
    } else if (status === 'review') {
      $('decision').className = 'mt-4 h5 status warn';
      $('decision').textContent = `REVISÃO NECESSÁRIA · OCR: ${validation.extracted || 'não identificado'} · score ${validation.score ?? '-'}`;
      resetFaceStep('Documento não gerou uma sessão válida para captura.');
    } else {
      $('decision').className = 'mt-4 h5 status bad';
      $('decision').textContent = `NOME NÃO CONFERE · esperado: ${payload.totem_context.guest_name} · OCR: ${validation.extracted || 'não identificado'}`;
      resetFaceStep('Documento não liberou a etapa de câmera.');
    }

    $('result').textContent = JSON.stringify(payload, null, 2);
  } catch (error) {
    $('decision').className = 'mt-4 h5 status bad';
    $('decision').textContent = 'Falha na integração.';
    $('result').textContent = error.message;
    resetFaceStep('Falha na análise do documento.');
  } finally {
    $('analyzeBtn').disabled = false;
  }
});

if (!window.isSecureContext) $('secureWarning').hidden = false;
initCaptureGuide();
window.addEventListener('beforeunload', stopCamera);
refreshScannerStatus();
