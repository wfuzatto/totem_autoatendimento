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
