(() => {
  const page = document.body.dataset.page || '';
  const legalKey = document.body.dataset.legalKey || '';
  const operationalPages = ['guide','releases','issues','support','account'];
  const legalPages = ['privacy','terms','data-deletion'];
  if (!operationalPages.includes(page) && !legalPages.includes(legalKey)) return;

  function qs(selector, root = document) { return root.querySelector(selector); }
  function setText(node, value) { if (!node || value === undefined || value === null) return; node.textContent = String(value); node.style.whiteSpace = 'pre-line'; }
  function safeHref(value) {
    const href = String(value || '');
    if (/^\/(?!\/)[^\s]*$/.test(href)) return href;
    try { const url = new URL(href); if (url.protocol === 'https:') return url.toString(); } catch {}
    return '';
  }
  function appendInline(parent, source) {
    const text = String(source || '');
    const token = /(\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\))/g;
    let cursor = 0; let match;
    while ((match = token.exec(text))) {
      if (match.index > cursor) parent.append(document.createTextNode(text.slice(cursor, match.index)));
      if (match[2] !== undefined) { const strong = document.createElement('strong'); strong.textContent = match[2]; parent.append(strong); }
      else if (match[3] !== undefined) { const code = document.createElement('code'); code.textContent = match[3]; parent.append(code); }
      else {
        const href = safeHref(match[5]);
        if (href) { const link = document.createElement('a'); link.textContent = match[4]; link.href = href; if (href.startsWith('https://')) { link.target = '_blank'; link.rel = 'noopener noreferrer'; } parent.append(link); }
        else parent.append(document.createTextNode(match[4]));
      }
      cursor = token.lastIndex;
    }
    if (cursor < text.length) parent.append(document.createTextNode(text.slice(cursor)));
  }
  function renderLegalMarkdown(container, content) {
    const lines = String(content || '').replace(/\r\n?/g, '\n').split('\n');
    container.replaceChildren();
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { i += 1; continue; }
      if (line.startsWith('## ')) { const h2 = document.createElement('h2'); appendInline(h2, line.slice(3)); container.append(h2); i += 1; continue; }
      if (line.startsWith('> ')) {
        const box = document.createElement('div'); box.className = 'box';
        let first = true;
        while (i < lines.length && lines[i].startsWith('> ')) {
          let value = lines[i].slice(2);
          if (first) {
            const danger = value.match(/^\[!DANGER\]\s*/); const note = value.match(/^\[!NOTE\]\s*/);
            if (danger) { box.classList.add('danger'); value = value.slice(danger[0].length); }
            else if (note) value = value.slice(note[0].length);
            const strong = document.createElement('strong'); appendInline(strong, value); box.append(strong);
          } else { const p = document.createElement('p'); appendInline(p, value); box.append(p); }
          first = false; i += 1;
        }
        container.append(box); continue;
      }
      if (/^-\s+/.test(line)) {
        const ul = document.createElement('ul');
        while (i < lines.length && /^-\s+/.test(lines[i])) { const li = document.createElement('li'); appendInline(li, lines[i].replace(/^-\s+/, '')); ul.append(li); i += 1; }
        container.append(ul); continue;
      }
      if (/^\d+\.\s+/.test(line)) {
        const ol = document.createElement('ol');
        while (i < lines.length && /^\d+\.\s+/.test(lines[i])) { const li = document.createElement('li'); appendInline(li, lines[i].replace(/^\d+\.\s+/, '')); ol.append(li); i += 1; }
        container.append(ol); continue;
      }
      const paragraphLines = [];
      while (i < lines.length && lines[i].trim() && !lines[i].startsWith('## ') && !lines[i].startsWith('> ') && !/^-\s+/.test(lines[i]) && !/^\d+\.\s+/.test(lines[i])) { paragraphLines.push(lines[i].trim()); i += 1; }
      const p = document.createElement('p'); appendInline(p, paragraphLines.join(' ')); container.append(p);
    }
  }

  async function loadLegal() {
    const response = await fetch(`/site/api/legal/${encodeURIComponent(legalKey)}`, { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) return;
    const data = await response.json().catch(() => null); const doc = data?.document; if (!doc) return;
    if (doc.browserTitle) document.title = doc.browserTitle;
    let meta = qs('meta[name="description"]'); if (!meta) { meta = document.createElement('meta'); meta.name = 'description'; document.head.append(meta); }
    if (doc.description) meta.content = doc.description;
    const main = qs('main.legal'); if (!main) return;
    main.replaceChildren();
    const eyebrow = document.createElement('span'); eyebrow.className = 'eyebrow'; eyebrow.textContent = doc.eyebrow || '';
    const h1 = document.createElement('h1'); h1.textContent = doc.title || '';
    if (doc.subtitle) { h1.append(document.createElement('br')); const small = document.createElement('small'); small.textContent = doc.subtitle; h1.append(small); }
    const metaLine = document.createElement('p'); metaLine.className = 'meta'; metaLine.textContent = `最后更新 / Last updated: ${doc.lastUpdated || '—'} · v${Number(data.version || 0)}`;
    const body = document.createElement('div'); body.dataset.legalPublishedVersion = String(data.version || 0); renderLegalMarkdown(body, doc.content || '');
    main.append(eyebrow, h1, metaLine, body);
  }

  async function loadOperational() {
    const response = await fetch('/site/api/website', { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) return;
    const data = await response.json().catch(() => null); const config = data?.config; const current = config?.pages?.[page];
    if (!current) return;
    if (current.browserTitle) document.title = current.browserTitle;
    let meta = qs('meta[name="description"]');
    if (!meta) { meta = document.createElement('meta'); meta.name = 'description'; document.head.append(meta); }
    if (current.description) meta.content = current.description;
    applyHero(current.hero || {}); applyModules(current.modules || []);
  }
  function heroRoot() { if (['guide','releases','account'].includes(page)) return qs('.page-hero'); if (['issues','support'].includes(page)) return qs('main.support'); return null; }
  function applyHero(hero) {
    const root = heroRoot(); if (!root) return; setText(qs('.eyebrow', root), hero.eyebrow); const h1 = qs('h1', root); if (h1 && hero.title) setText(h1, hero.title);
    let body = null; if (['guide','releases','account'].includes(page)) body = qs(':scope > p', root); else body = [...root.children].find((node) => node.tagName === 'P'); if (body && hero.body) setText(body, hero.body);
  }
  function targetFor(id) {
    if (page === 'guide') { const sections = [...document.querySelectorAll('main > section')]; return id === 'guide-steps' ? sections[1] : id === 'guide-callout' ? sections[2] : null; }
    if (page === 'releases') { const sections = [...document.querySelectorAll('main > section')]; return id === 'release-feed' ? sections[1] : null; }
    if (page === 'issues') { const main = qs('main.support'); if (id === 'issues-search') return [...(main?.children || [])].find((node) => node.classList?.contains('release-card') && node.id !== 'newIssueCard' && node.id !== 'issueDetail') || null; if (id === 'issues-new') return qs('#newIssueCard'); if (id === 'issues-detail') return qs('#issueDetail'); if (id === 'issues-list') return qs('#issueListWrap'); }
    if (page === 'support') { if (id === 'support-links') return qs('main.support > .cards'); if (id === 'support-warning') return qs('main.support > .warn'); }
    if (page === 'account') { if (id === 'account-login') return qs('#loginCard'); if (id === 'account-dashboard') return qs('.account-layout > section.account-card'); }
    return null;
  }
  function moduleRoot() { if (page === 'guide' || page === 'releases') return qs('main'); if (page === 'issues' || page === 'support') return qs('main.support'); if (page === 'account') return qs('.account-layout'); return null; }
  function applyCallout(target, module) { if (!target) return; setText(qs('h2', target), module.title); setText(qs('p', target), module.body); const link = qs('a.btn', target); if (link) { setText(link, module.buttonLabel); if (module.buttonHref) link.href = module.buttonHref; } }
  function applyModules(modules) {
    const sorted = [...modules].sort((a, b) => Number(a.order) - Number(b.order)); const root = moduleRoot();
    for (const module of sorted) { const target = targetFor(module.id); if (!target) continue; if (!module.enabled) target.style.display = 'none'; else target.style.removeProperty('display'); target.dataset.cmsPageModule = module.id; if (module.type === 'callout') applyCallout(target, module); }
    if (!root || page === 'support') return; for (const module of sorted) { if (module.lockedOrder) continue; const target = targetFor(module.id); if (target && target.parentElement === root) root.append(target); }
  }

  if (legalPages.includes(legalKey)) void loadLegal().catch(() => {}); else void loadOperational().catch(() => {});
})();
