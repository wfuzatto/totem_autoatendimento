(function () {
  class FaceCaptureGuide {
    constructor(options) {
      this.video = options.video;
      this.guide = options.guide;
      this.instruction = options.instruction;
      this.metrics = options.metrics;
      this.countdown = options.countdown;
      this.previewEndpoint = options.previewEndpoint;
      this.onAutoCapture = options.onAutoCapture;
      this.intervalMs = options.intervalMs || 800;
      this.timer = null;
      this.checking = false;
      this.paused = true;
      this.readySince = null;
      this.countdownTimer = null;
      this.cooldownUntil = 0;
      this.previewCanvas = document.createElement('canvas');
    }

    start() {
      this.stop(false);
      this.paused = false;
      this.readySince = null;
      this.setState('warn', 'Posicione seu rosto dentro da área indicada.', 'Aguardando análise…');
      this.timer = window.setInterval(() => this.checkOnce(), this.intervalMs);
      this.checkOnce();
    }

    stop(reset = true) {
      if (this.timer) window.clearInterval(this.timer);
      this.timer = null;
      this.checking = false;
      this.paused = true;
      this.readySince = null;
      this.cancelCountdown();
      if (reset) this.setState('idle', 'Posicione seu rosto dentro da área indicada.', 'Pré-análise parada');
    }

    setPaused(value) {
      this.paused = Boolean(value);
      this.readySince = null;
      this.cancelCountdown();
      if (!this.paused) this.cooldownUntil = Date.now() + 1200;
    }

    async frameBlob(maxWidth = 720, jpegQuality = 0.84) {
      if (!this.video.videoWidth || !this.video.videoHeight) return null;
      const scale = Math.min(1, maxWidth / this.video.videoWidth);
      const width = Math.max(1, Math.round(this.video.videoWidth * scale));
      const height = Math.max(1, Math.round(this.video.videoHeight * scale));
      this.previewCanvas.width = width;
      this.previewCanvas.height = height;
      const ctx = this.previewCanvas.getContext('2d', { alpha: false });
      ctx.drawImage(this.video, 0, 0, width, height);
      return await new Promise(resolve => this.previewCanvas.toBlob(resolve, 'image/jpeg', jpegQuality));
    }

    async checkOnce() {
      if (this.paused || this.checking || document.hidden) return;
      if (!this.video.videoWidth || !this.video.videoHeight) return;
      this.checking = true;
      try {
        const blob = await this.frameBlob();
        if (!blob) return;
        const form = new FormData();
        form.append('selfie', blob, 'preview.jpg');
        const response = await fetch(this.previewEndpoint, { method: 'POST', body: form });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || payload.detail || `HTTP ${response.status}`);
        this.applyResult(payload.face_scanner || {});
      } catch (error) {
        this.readySince = null;
        this.cancelCountdown();
        this.setState('warn', 'Não se mexa. Tentando avaliar a imagem novamente…', `Pré-análise: ${error.message}`);
      } finally {
        this.checking = false;
      }
    }

    applyResult(result) {
      const quality = result.quality || {};
      const issues = Array.isArray(quality.issues) ? quality.issues : [];
      const faceCount = Number(result.face_count || 0);
      const bbox = Array.isArray(result.bbox) ? result.bbox : null;
      const iw = Number(result.image_width || 0);
      const ih = Number(result.image_height || 0);

      let state = 'warn';
      let message = 'Ajuste sua posição.';
      let centered = false;

      if (faceCount === 0) {
        state = 'bad';
        message = 'Posicione seu rosto dentro da área indicada.';
      } else if (faceCount > 1) {
        state = 'bad';
        message = 'Apenas uma pessoa deve aparecer na câmera.';
      } else if (bbox && iw > 0 && ih > 0) {
        const [x, y, w, h] = bbox;
        const cx = (x + w / 2) / iw;
        const cy = (y + h / 2) / ih;
        const dx = Math.abs(cx - 0.5);
        const dy = Math.abs(cy - 0.48);
        centered = dx <= 0.16 && dy <= 0.20;

        if (quality.face_ratio < 0.105) {
          message = 'Aproxime um pouco o rosto da câmera.';
        } else if (quality.face_ratio > 0.48) {
          message = 'Afaste um pouco o rosto da câmera.';
        } else if (!centered) {
          message = 'Centralize o rosto dentro da área indicada.';
        } else if (issues.includes('imagem_escura')) {
          message = 'Melhore a iluminação do seu rosto.';
        } else if (issues.includes('imagem_clara_demais')) {
          message = 'Evite luz forte diretamente no rosto.';
        } else if (issues.includes('imagem_desfocada')) {
          message = 'Não se mexa. Aguarde a imagem ficar nítida.';
        } else if (quality.acceptable) {
          state = 'good';
          message = 'Perfeito! Olhe para frente e não se mexa.';
        }
      }

      const metricText = faceCount === 1
        ? `nitidez ${Number(quality.blur_score || 0).toFixed(1)} · luz ${Number(quality.brightness || 0).toFixed(0)} · rosto ${(Number(quality.face_ratio || 0) * 100).toFixed(1)}%`
        : `${faceCount} rosto(s) detectado(s)`;

      this.setState(state, message, metricText);

      const ready = state === 'good' && centered && quality.acceptable;
      if (!ready) {
        this.readySince = null;
        this.cancelCountdown();
        return;
      }

      if (!this.readySince) this.readySince = Date.now();
      if (
        Date.now() - this.readySince >= 900 &&
        !this.countdownTimer &&
        Date.now() >= this.cooldownUntil
      ) {
        this.startCountdown();
      }
    }

    setState(state, message, metricText) {
      if (this.guide) {
        this.guide.classList.remove('guide-idle', 'guide-bad', 'guide-warn', 'guide-good');
        this.guide.classList.add(`guide-${state}`);
      }
      if (this.instruction) {
        this.instruction.classList.remove('capture-bad', 'capture-warn', 'capture-good');
        if (state === 'bad') this.instruction.classList.add('capture-bad');
        else if (state === 'good') this.instruction.classList.add('capture-good');
        else this.instruction.classList.add('capture-warn');
        this.instruction.textContent = message;
      }
      if (this.metrics) this.metrics.textContent = metricText || '';
    }

    startCountdown() {
      let count = 3;
      if (this.countdown) {
        this.countdown.hidden = false;
        this.countdown.textContent = String(count);
      }
      this.setState('good', 'Perfeito! Não se mexa…', this.metrics?.textContent || '');
      this.countdownTimer = window.setInterval(() => {
        count -= 1;
        if (count > 0) {
          if (this.countdown) this.countdown.textContent = String(count);
          return;
        }
        this.cancelCountdown();
        this.cooldownUntil = Date.now() + 4000;
        if (!this.paused && typeof this.onAutoCapture === 'function') this.onAutoCapture();
      }, 650);
    }

    cancelCountdown() {
      if (this.countdownTimer) window.clearInterval(this.countdownTimer);
      this.countdownTimer = null;
      if (this.countdown) {
        this.countdown.hidden = true;
        this.countdown.textContent = '';
      }
    }
  }

  window.FaceCaptureGuide = FaceCaptureGuide;
})();

// Homologação visual da etapa de preparação geométrica. Este bloco somente
// exibe landmarks/alinhamento já produzidos pelo Face Scanner; não compara
// identidades, não calcula embeddings e não toma decisão biométrica.
(function () {
  function safeJson(text) {
    try { return JSON.parse(text); } catch (_) { return null; }
  }

  function makePanel() {
    const anchor = document.getElementById('faceComparison');
    if (!anchor || document.getElementById('alignmentComparison')) return;

    const section = document.createElement('div');
    section.id = 'alignmentComparison';
    section.className = 'mt-4';
    section.innerHTML = `
      <h3 class="h4 fw-bold mb-2">Preparação facial · landmarks + alinhamento</h3>
      <p class="muted mb-3">Prévia geométrica para homologação. Esta etapa não verifica identidade.</p>
      <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;max-width:760px">
        <div style="border:1px solid #d8e1e8;border-radius:18px;padding:14px;background:#f7fafc">
          <div class="fw-bold mb-2">Documento alinhado</div>
          <div style="aspect-ratio:1;background:#dfe7ec;border-radius:14px;overflow:hidden;display:flex;align-items:center;justify-content:center">
            <img id="documentAlignedImg" alt="Face do documento alinhada" style="width:100%;height:100%;object-fit:cover" hidden>
            <span id="documentAlignedPlaceholder" class="muted">Aguardando alinhamento.</span>
          </div>
          <div id="documentAlignedMeta" class="muted mt-2" style="font-size:.9rem">Landmarks: aguardando.</div>
        </div>
        <div style="border:1px solid #d8e1e8;border-radius:18px;padding:14px;background:#f7fafc">
          <div class="fw-bold mb-2">Webcam alinhada</div>
          <div style="aspect-ratio:1;background:#dfe7ec;border-radius:14px;overflow:hidden;display:flex;align-items:center;justify-content:center">
            <img id="liveAlignedImg" alt="Face da webcam alinhada" style="width:100%;height:100%;object-fit:cover" hidden>
            <span id="liveAlignedPlaceholder" class="muted">Aguardando captura.</span>
          </div>
          <div id="liveAlignedMeta" class="muted mt-2" style="font-size:.9rem">Landmarks: aguardando.</div>
        </div>
      </div>`;
    anchor.insertAdjacentElement('afterend', section);
  }

  function showAligned(prefix, alignment, landmarks) {
    const image = document.getElementById(`${prefix}AlignedImg`);
    const placeholder = document.getElementById(`${prefix}AlignedPlaceholder`);
    const meta = document.getElementById(`${prefix}AlignedMeta`);
    if (!image || !placeholder || !meta) return;

    const count = landmarks && typeof landmarks === 'object' ? Object.keys(landmarks).length : 0;
    if (alignment?.success && alignment?.jpeg_base64) {
      image.src = `data:image/jpeg;base64,${alignment.jpeg_base64}`;
      image.hidden = false;
      placeholder.hidden = true;
      meta.textContent = `Landmarks: ${count}/5 · alinhamento: OK · ${alignment.width || '-'}×${alignment.height || '-'}`;
    } else {
      image.removeAttribute('src');
      image.hidden = true;
      placeholder.hidden = false;
      meta.textContent = `Landmarks: ${count}/5 · alinhamento: ${alignment?.message || 'aguardando'}`;
    }
  }

  function updateDocument() {
    const payload = safeJson(document.getElementById('result')?.textContent || '');
    const portrait = payload?.face_scanner?.portrait;
    if (portrait) showAligned('document', portrait.alignment, portrait.landmarks);
  }

  function updateLive() {
    const payload = safeJson(document.getElementById('faceResult')?.textContent || '');
    const result = payload?.face_scanner;
    if (result) showAligned('live', result.alignment, result.landmarks);
  }

  function init() {
    makePanel();
    const documentResult = document.getElementById('result');
    const liveResult = document.getElementById('faceResult');
    if (documentResult) new MutationObserver(updateDocument).observe(documentResult, { childList: true, subtree: true, characterData: true });
    if (liveResult) new MutationObserver(updateLive).observe(liveResult, { childList: true, subtree: true, characterData: true });
    updateDocument();
    updateLive();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
