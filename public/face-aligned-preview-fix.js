(() => {
  const activeUrls = new Map();
  const alignedIds = new Set(['documentAlignedImg', 'liveAlignedImg']);

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

    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) {
      throw new Error('payload alinhado não contém JPEG válido');
    }

    return new Blob([bytes], { type: 'image/jpeg' });
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
      const blob = decodeJpegBase64(encoded);
      const previous = activeUrls.get(prefix);
      if (previous) URL.revokeObjectURL(previous);
      const url = URL.createObjectURL(blob);
      activeUrls.set(prefix, url);

      image.dataset.alignedBlobConverting = '1';
      image.onload = () => {
        image.hidden = false;
        if (placeholder) placeholder.hidden = true;
        setMeta(prefix, `${label} · JPEG ${blob.size} bytes`);
        delete image.dataset.alignedBlobConverting;
      };
      image.onerror = () => {
        image.hidden = true;
        if (placeholder) placeholder.hidden = false;
        setMeta(prefix, 'Falha ao renderizar o JPEG alinhado recebido do Face Scanner.');
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

  // Compatibilidade com a função legada já carregada em face-scanner-test.js:
  // caso ela atribua uma data URL diretamente ao <img>, convertemos imediatamente
  // para Blob URL. Assim o preview funciona mesmo se o binding global antigo for usado.
  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      const image = mutation.target;
      if (!(image instanceof HTMLImageElement) || !alignedIds.has(image.id)) continue;
      if (image.dataset.alignedBlobConverting === '1') continue;
      const src = image.getAttribute('src') || '';
      if (!src.startsWith('data:image/') || !src.includes(';base64,')) continue;
      const prefix = prefixFor(image);
      const encoded = src.slice(src.indexOf(',') + 1);
      renderBlob(prefix, image, encoded);
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
