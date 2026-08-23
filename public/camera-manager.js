(() => {
  if (!navigator.mediaDevices?.getUserMedia) return;

  const mediaDevices = navigator.mediaDevices;
  const nativeGetUserMedia = mediaDevices.getUserMedia.bind(mediaDevices);
  const nativeEnumerateDevices = mediaDevices.enumerateDevices?.bind(mediaDevices);

  // Browsers não expõem diretamente se uma câmera está ligada via USB.
  // Depois da primeira autorização, os labels ficam disponíveis e usamos
  // nomes comuns de webcams USB/UVC para dar preferência à câmera externa.
  const externalCameraPattern = /\busb\b|\buvc\b|webcam|logitech|brio|c9\d{2}|external camera|elgato|razer kiyo/i;

  const cloneVideoConstraints = video => {
    if (!video || video === true || typeof video !== 'object') return {};
    const result = { ...video };
    // A escolha do deviceId é responsabilidade deste gerenciador.
    delete result.deviceId;
    return result;
  };

  mediaDevices.getUserMedia = async constraints => {
    if (!constraints?.video || !nativeEnumerateDevices) {
      return nativeGetUserMedia(constraints);
    }

    const videoConstraints = cloneVideoConstraints(constraints.video);
    const audioConstraints = constraints.audio ?? false;

    // Primeiro abre a câmera default do navegador. Isso também libera os labels
    // dos dispositivos após a permissão do usuário/Electron.
    const defaultStream = await nativeGetUserMedia({
      video: videoConstraints,
      audio: audioConstraints
    });

    try {
      const cameras = (await nativeEnumerateDevices()).filter(device => device.kind === 'videoinput');
      const currentTrack = defaultStream.getVideoTracks()[0];
      const currentDeviceId = currentTrack?.getSettings?.().deviceId;
      const externalCamera = cameras.find(camera => externalCameraPattern.test(camera.label || ''));

      // Sem webcam USB detectável: mantém exatamente a câmera padrão do navegador.
      if (!externalCamera?.deviceId || externalCamera.deviceId === currentDeviceId) {
        console.info('[camera] Usando câmera padrão do navegador:', currentTrack?.label || 'default');
        return defaultStream;
      }

      try {
        const externalStream = await nativeGetUserMedia({
          video: {
            ...videoConstraints,
            deviceId: { exact: externalCamera.deviceId }
          },
          audio: audioConstraints
        });

        defaultStream.getTracks().forEach(track => track.stop());
        console.info('[camera] Webcam USB selecionada:', externalCamera.label || externalCamera.deviceId);
        return externalStream;
      } catch (externalError) {
        // Se a USB existir mas estiver ocupada/indisponível, o hóspede não fica bloqueado.
        console.warn('[camera] Webcam USB indisponível; usando câmera padrão.', externalError);
        return defaultStream;
      }
    } catch (enumerationError) {
      // enumerateDevices pode ser limitado por permissões/política do navegador.
      // Nesse caso a câmera default, já aberta, continua funcionando.
      console.warn('[camera] Não foi possível enumerar câmeras; usando câmera padrão.', enumerationError);
      return defaultStream;
    }
  };
})();
