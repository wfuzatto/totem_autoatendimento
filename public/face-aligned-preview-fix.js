(() => {
  // Renderização robusta dos previews alinhados recebidos do Face Scanner.
  // O backend envia JPEG em base64. Em vez de depender de uma data: URL longa,
  // decodificamos o payload e usamos um Blob URL local do navegador.
  const activeUrls = new Map();

  function decodeJpegBase64(value) {
    let encoded = String(value || '').trim();
    if (!encoded) throw new Error('preview alinhado sem dados JPEG');

    encoded = encoded
      .replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '')
      .replace(/\s+/g, '')
      .replace(/-/g, '+')
      .replace(/_/g, '/');

    while (encoded.length % 4) encoded += '=';

    const binary = atob(encoded);
    if (binary.length < 4) throw new Error('JPEG alinhado vazio');

    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);

    // SOI JPEG: FF D8. O Face Scanner gera os previews com cv2.imencode('.jpg').
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) {
      throw new Error('payload alinhado não contém JPEG válido');
    }

    return new Blob([bytes], { type: 'image/jpeg' });
  }

  window.showAlignedFace = function showAlignedFace(prefix, alignment, label) {
    const image = document.getElementById(`${prefix}Img`);
    const placeholder = document.getElementById(`${prefix}Placeholder`);
    const meta = document.getElementById(`${prefix}Meta`);
    const comparison = document.getElementById('faceComparison');
    if (!image || !placeholder || !meta) return;

    const encoded = alignment?.jpeg_base64;
    if (!alignment?.success || !encoded) {
      image.hidden = true;
      placeholder.hidden = false;
      meta.textContent = alignment?.message || 'Preview alinhado não disponível.';
      return;
    }

    try {
      const previous = activeUrls.get(prefix);
      if (previous) URL.revokeObjectURL(previous);

      const blob = decodeJpegBase64(encoded);
      const url = URL.createObjectURL(blob);
      activeUrls.set(prefix, url);

      image.onload = () => {
        image.hidden = false;
        placeholder.hidden = true;
        meta.textContent = `${label} · ${alignment.width || '?'}×${alignment.height || '?'} px`;
      };
      image.onerror = () => {
        image.hidden = true;
        placeholder.hidden = false;
        meta.textContent = 'Falha ao renderizar o JPEG alinhado recebido do Face Scanner.';
      };
      image.src = url;
      comparison.hidden = false;
    } catch (error) {
      image.removeAttribute('src');
      image.hidden = true;
      placeholder.hidden = false;
      meta.textContent = `Preview alinhado inválido: ${error.message}`;
      comparison.hidden = false;
    }
  };
})();
