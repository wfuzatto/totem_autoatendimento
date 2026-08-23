(() => {
  let audioContext = null;
  let unlocked = false;

  function getContext() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    if (!audioContext) audioContext = new AudioContextClass();
    return audioContext;
  }

  async function unlockAudio() {
    const ctx = getContext();
    if (!ctx) return false;
    try {
      if (ctx.state === 'suspended') await ctx.resume();
      unlocked = ctx.state === 'running';
      return unlocked;
    } catch (_) {
      return false;
    }
  }

  function synthesizeToc(ctx) {
    const now = ctx.currentTime;

    // Corpo curto do clique.
    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(780, now);
    osc.frequency.exponentialRampToValueAtTime(310, now + 0.055);
    oscGain.gain.setValueAtTime(0.12, now);
    oscGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
    osc.connect(oscGain);
    oscGain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.065);

    // Pequeno ataque percussivo para o som lembrar um botão físico.
    const buffer = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * 0.018)), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) {
      const envelope = 1 - (i / data.length);
      data[i] = (Math.random() * 2 - 1) * envelope;
    }
    const noise = ctx.createBufferSource();
    const noiseGain = ctx.createGain();
    noise.buffer = buffer;
    noiseGain.gain.setValueAtTime(0.055, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.02);
    noise.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    noise.start(now);
    noise.stop(now + 0.022);
  }

  async function playToc() {
    const ctx = getContext();
    if (!ctx) return;
    if (!unlocked || ctx.state !== 'running') {
      const ready = await unlockAudio();
      if (!ready) return;
    }
    try { synthesizeToc(ctx); } catch (_) {}
  }

  // O primeiro gesto do usuário desbloqueia o Web Audio antecipadamente.
  document.addEventListener('pointerdown', () => {
    if (!unlocked) unlockAudio();
  }, { capture: true, once: true });

  // Captura qualquer tecla atual ou futura do teclado virtual.
  document.addEventListener('pointerdown', event => {
    const key = event.target.closest?.('#v2OnScreenKeyboard [data-osk-action]');
    if (!key) return;
    playToc();
  }, true);
})();
