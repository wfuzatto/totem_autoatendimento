(() => {
  const DATE_RE = /\b(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?\b/g;
  const DATE_TEST_RE = /\b\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?\b/;

  function formatText(text) {
    return String(text).replace(DATE_RE, (_all, year, month, day, hour, minute) => {
      const date = `${day}/${month}/${year}`;
      return hour ? `${date} ${hour}:${minute}` : date;
    });
  }

  function process(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || ['SCRIPT','STYLE','TEXTAREA','INPUT','OPTION'].includes(parent.tagName)) return NodeFilter.FILTER_REJECT;
        return DATE_TEST_RE.test(node.nodeValue || '') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(node => { node.nodeValue = formatText(node.nodeValue); });
  }

  process(document.body);
  new MutationObserver(mutations => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach(node => {
        if (node.nodeType === Node.TEXT_NODE) node.nodeValue = formatText(node.nodeValue);
        else if (node.nodeType === Node.ELEMENT_NODE) process(node);
      });
    }
  }).observe(document.body, { childList: true, subtree: true });
})();
