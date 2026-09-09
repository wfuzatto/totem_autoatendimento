(() => {
  const activeUrls = new Map();
  const alignedIds = new Set(['documentAlignedImg', 'liveAlignedImg']);

  function normalizeBase64(value) {
    let encoded = String(value || '').trim();
    if (!encoded) throw new Error('preview alinhado sem dados');
    encoded = encoded
      .replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '')
      .replace(/^['"]|['"]$/g, '')
      .replace(/\s+/g, '')
      .replace(/-/g, '+')
      .replace(/_/g, '/');
    while (encoded.length % 4) encoded += '=';
    return encoded;
  }

  function decodeBase64Bytes(value) {
    const binary = atob(normalizeBase64(value));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function detectImageType(bytes) {
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return 'image/jpeg';
    }
    if (
      bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
      bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
    ) {
      return 'image/png';
    }
    if (
      bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
    ) {
      return 'image/webp';
    }
    return null;
  }

  function asciiFromBytes(bytes) {
    let text = '';
    const limit = Math.min(bytes.length, 2_000_000);
    for (let i = 0; i < limit; i += 1) text += String.fromCharCode(bytes[i]);
    return text.trim();
  }

  function decodeAlignedImage(value) {
    let bytes = decodeBase64Bytes(value);
    let mime = detectImageType(bytes);

    // Compatibilidade com payloads antigos/intermediários que passaram por uma
    // segunda codificação base64 ou carregavam uma data URL dentro do base64.
    if (!mime) {
      const nested = asciiFromBytes(bytes);
      if (nested.startsWith('data:image/') || /^[A-Za-z0-9+/_=-]+$/.test(nested)) {
        try {
          bytes = decodeBase64Bytes(nested);
          mime = detectImageType(bytes);
        } catch (_) {
          // Mantém o diagnóstico original abaixo.
        }
      }
    }

    if (!mime) {
      const prefix = Array.from(bytes.slice(0, 12))
        .map(value => value.toString(16).padStart(2, '0'))
        .join(' ');
      throw new Error(`formato de imagem desconhecido (início: ${prefix || 'vazio'})`);
    }

    return { blob: new Blob([bytes], { type: mime }), mime };
  }

  function prefixFor(image) {
    return image.id === 'documentAlignedImg' ? 'documentAligned' : 'liveAligned';
  }

  function setMeta(prefix, text) {
    const meta = document.getElementById(`${prefix}Meta`);
    if (meta) meta.textContent = text;
  }

  function renderBlob(prefix, image, encoded, label = 'Face alinhada recebida do Face Scanner.') {
    const placeholder = document.getElementById(`${prefix}Placeholder`);
    const comparison = document.getElementById('faceComparison');

    try {
      const { blob, mime } = decodeAlignedImage(encoded);
      const previous = activeUrls.get(prefix);
      if (previous) URL.revokeObjectURL(previous);
      const url = URL.createObjectURL(blob);
      activeUrls.set(prefix, url);

      image.dataset.alignedBlobConverting = '1';
      image.onload = () => {
        image.hidden = false;
        if (placeholder) placeholder.hidden = true;
        setMeta(prefix, `${label} · ${mime.replace('image/', '').toUpperCase()} ${blob.size} bytes`);
        delete image.dataset.alignedBlobConverting;
      };
      image.onerror = () => {
        image.hidden = true;
        if (placeholder) placeholder.hidden = false;
        setMeta(prefix, 'Falha ao renderizar a imagem alinhada recebida do Face Scanner.');
        delete image.dataset.alignedBlobConverting;
      };
      image.src = url;
      if (comparison) comparison.hidden = false;
    } catch (error) {
      image.removeAttribute('src');
      image.hidden = true;
      if (placeholder) placeholder.hidden = false;
      setMeta(prefix, `Preview alinhado inválido: ${error.message}`);
      if (comparison) comparison.hidden = false;
    }
  }

  window.showAlignedFace = function showAlignedFace(prefix, alignment, label) {
    const image = document.getElementById(`${prefix}Img`);
    const placeholder = document.getElementById(`${prefix}Placeholder`);
    if (!image || !placeholder) return;

    const encoded = alignment?.jpeg_base64;
    if (!alignment?.success || !encoded) {
      image.hidden = true;
      placeholder.hidden = false;
      setMeta(prefix, alignment?.message || 'Preview alinhado não disponível.');
      return;
    }

    renderBlob(prefix, image, encoded, label);
  };

  // Compatibilidade com a função legada carregada em face-scanner-test.js.
  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      const image = mutation.target;
      if (!(image instanceof HTMLImageElement) || !alignedIds.has(image.id)) continue;
      if (image.dataset.alignedBlobConverting === '1') continue;
      const src = image.getAttribute('src') || '';
      if (!src.startsWith('data:image/') || !src.includes(';base64,')) continue;
      const prefix = prefixFor(image);
      renderBlob(prefix, image, src.slice(src.indexOf(',') + 1));
    }
  });

  function watch() {
    for (const id of alignedIds) {
      const image = document.getElementById(id);
      if (!image) continue;
      observer.observe(image, { attributes: true, attributeFilter: ['src'] });
      const src = image.getAttribute('src') || '';
      if (src.startsWith('data:image/') && src.includes(';base64,')) {
        renderBlob(prefixFor(image), image, src.slice(src.indexOf(',') + 1));
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', watch, { once: true });
  } else {
    watch();
  }
})();
