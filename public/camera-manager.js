(() => {
  if (!navigator.mediaDevices?.getUserMedia) return;

  const mediaDevices = navigator.mediaDevices;
  const nativeGetUserMedia = mediaDevices.getUserMedia.bind(mediaDevices);
  const nativeEnumerateDevices = mediaDevices.enumerateDevices?.bind(mediaDevices);

  // TESTE CONTROLADO: mantém uma webcam física aberta durante toda a sessão da página
  // e entrega clones do track para QR/documento/face. Assim, quando uma tela chama
  // track.stop(), somente o clone daquela tela é encerrado e o hardware continua quente.
  const HOT_CONSTRAINTS = {
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    frameRate: { ideal: 30 }
  };

  const externalCameraPattern = /\busb\b|\buvc\b|webcam|logitech|brio|c9\d{2}|external camera|elgato|razer kiyo/i;

  let masterStream = null;
  let masterTrack = null;
  let masterPromise = null;
  let openedAt = null;
  let cloneCount = 0;

  const isMasterAlive = () => Boolean(masterTrack && masterTrack.readyState === 'live');

  const cloneVideoConstraints = video => {
    if (!video || video === true || typeof video !== 'object') return {};
    const result = { ...video };
    // A escolha do deviceId é responsabilidade deste gerenciador.
    delete result.deviceId;
    return result;
  };

  async function openPreferredMaster() {
    const startedAt = performance.now();

    // Abre primeiro a câmera default. Além de aquecer o hardware, isso libera os labels
    // depois que a permissão do navegador/Electron já foi concedida.
    const defaultStream = await nativeGetUserMedia({
      video: HOT_CONSTRAINTS,
      audio: false
    });

    let selectedStream = defaultStream;

    if (nativeEnumerateDevices) {
      try {
        const cameras = (await nativeEnumerateDevices()).filter(device => device.kind === 'videoinput');
        const currentTrack = defaultStream.getVideoTracks()[0];
        const currentDeviceId = currentTrack?.getSettings?.().deviceId;
        const externalCamera = cameras.find(camera => externalCameraPattern.test(camera.label || ''));

        if (externalCamera?.deviceId && externalCamera.deviceId !== currentDeviceId) {
          try {
            const externalStream = await nativeGetUserMedia({
              video: {
                ...HOT_CONSTRAINTS,
                deviceId: { exact: externalCamera.deviceId }
              },
              audio: false
            });
            defaultStream.getTracks().forEach(track => track.stop());
            selectedStream = externalStream;
            console.info('[camera-hot] Webcam USB selecionada:', externalCamera.label || externalCamera.deviceId);
          } catch (externalError) {
            console.warn('[camera-hot] Webcam USB indisponível; mantendo câmera padrão.', externalError);
          }
        }
      } catch (enumerationError) {
        console.warn('[camera-hot] Não foi possível enumerar câmeras; mantendo câmera padrão.', enumerationError);
      }
    }

    const track = selectedStream.getVideoTracks()[0];
    if (!track) {
      selectedStream.getTracks().forEach(item => item.stop());
      throw new Error('Nenhum track de vídeo foi retornado pela webcam.');
    }

    masterStream = selectedStream;
    masterTrack = track;
    openedAt = Date.now();

    track.addEventListener('ended', () => {
      if (masterTrack !== track) return;
      console.warn('[camera-hot] Stream mestre da webcam foi encerrado pelo hardware/navegador.');
      masterStream = null;
      masterTrack = null;
      openedAt = null;
    }, { once: true });

    console.info(
      '[camera-hot] Webcam mestre pronta em',
      Math.round(performance.now() - startedAt),
      'ms:',
      track.label || 'default',
      track.getSettings?.() || {}
    );

    return selectedStream;
  }

  async function ensureMaster() {
    if (isMasterAlive()) return masterStream;
    if (masterPromise) return masterPromise;

    masterPromise = openPreferredMaster()
      .finally(() => { masterPromise = null; });

    return masterPromise;
  }

  function cloneMasterStream() {
    if (!isMasterAlive()) throw new Error('Webcam mestre não está ativa.');
    const clone = masterTrack.clone();
    cloneCount += 1;
    console.info('[camera-hot] Reutilizando webcam quente; clone', cloneCount);
    return new MediaStream([clone]);
  }

  mediaDevices.getUserMedia = async constraints => {
    // Áudio não faz parte deste teste; nesses casos preserva o comportamento nativo.
    if (!constraints?.video || constraints.audio) {
      return nativeGetUserMedia(constraints);
    }

    try {
      await ensureMaster();
      return cloneMasterStream();
    } catch (error) {
      // Se o warm-up falhar (permissão, contexto inseguro, câmera removida), não bloqueia o Totem.
      // Mantém o caminho nativo existente para que a tela ainda possa tentar abrir a câmera.
      console.warn('[camera-hot] Warm-up indisponível; usando abertura nativa nesta chamada.', error);
      return nativeGetUserMedia({
        ...constraints,
        video: cloneVideoConstraints(constraints.video)
      });
    }
  };

  async function warmup() {
    try {
      await ensureMaster();
      return true;
    } catch (error) {
      console.warn('[camera-hot] Não foi possível pré-aquecer a webcam.', error);
      return false;
    }
  }

  function shutdown() {
    if (masterStream) masterStream.getTracks().forEach(track => track.stop());
    masterStream = null;
    masterTrack = null;
    openedAt = null;
    console.info('[camera-hot] Webcam mestre liberada manualmente.');
  }

  window.TotemCameraManager = {
    warmup,
    shutdown,
    status() {
      return {
        hot: isMasterAlive(),
        readyState: masterTrack?.readyState || 'closed',
        label: masterTrack?.label || null,
        settings: masterTrack?.getSettings?.() || null,
        openedAt,
        cloneCount
      };
    }
  };

  // Tenta aquecer assim que o sistema entra. Em ambientes que exigirem gesto do usuário,
  // a primeira interação também dispara uma nova tentativa automaticamente.
  const startWarmup = () => { void warmup(); };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startWarmup, { once: true });
  } else {
    setTimeout(startWarmup, 0);
  }

  document.addEventListener('pointerdown', () => {
    if (!isMasterAlive()) void warmup();
  }, { once: true, passive: true });
})();
