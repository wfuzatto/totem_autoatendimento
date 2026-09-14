(() => {
  const script = document.currentScript;
  const base = script ? new URL(script.src, window.location.href).pathname.replace(/\/base-path\.js$/, '') : '';
  if (!base) return;

  const originalFetch = window.fetch.bind(window);
  const rewrite = value => {
    if (typeof value !== 'string' || !value.startsWith('/api/')) return value;
    return `${base}${value}`;
  };

  window.fetch = (input, init) => {
    if (typeof input === 'string') return originalFetch(rewrite(input), init);
    if (input instanceof Request) return originalFetch(new Request(rewrite(input.url), input), init);
    return originalFetch(input, init);
  };
})();
