(() => {
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await nativeFetch(...args);
    try {
      const input = args[0];
      const url = typeof input === 'string' ? input : input?.url || '';
      const method = String(args[1]?.method || 'GET').toUpperCase();
      if (response.ok && method === 'POST' && /\/api\/admin\/login(?:\?|$)/.test(url)) {
        const data = await response.clone().json();
        if (data?.token) sessionStorage.setItem('totem-admin-token', data.token);
      }
      if (response.ok && method === 'POST' && /\/api\/admin\/logout(?:\?|$)/.test(url)) {
        sessionStorage.removeItem('totem-admin-token');
      }
    } catch (_) {}
    return response;
  };
})();
