(() => {
  const configuredBase = '/totem';
  const onConfiguredBase = location.pathname === configuredBase || location.pathname.startsWith(`${configuredBase}/`);
  const basePath = onConfiguredBase ? configuredBase : '';
  window.__TOTEM_BASE_PATH__ = basePath;

  function prefixPath(value) {
    if (!basePath || typeof value !== 'string') return value;
    if (!value.startsWith('/') || value.startsWith('//')) return value;
    if (value === basePath || value.startsWith(`${basePath}/`)) return value;
    return `${basePath}${value}`;
  }

  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    if (typeof input === 'string') {
      return nativeFetch(prefixPath(input), init);
    }

    if (input instanceof Request) {
      try {
        const url = new URL(input.url, location.href);
        if (url.origin === location.origin) {
          const prefixed = prefixPath(url.pathname);
          if (prefixed !== url.pathname) {
            url.pathname = prefixed;
            return nativeFetch(new Request(url.toString(), input), init);
          }
        }
      } catch (_) {}
    }

    return nativeFetch(input, init);
  };

  window.totemPublicUrl = value => prefixPath(value);
})();
