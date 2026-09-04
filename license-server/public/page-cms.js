(() => {
  const page = document.body.dataset.page || '';
  if (!['guide','releases','issues','support','account'].includes(page)) return;

  function qs(selector, root = document) { return root.querySelector(selector); }
  function setText(node, value) { if (!node || value === undefined || value === null) return; node.textContent = String(value); node.style.whiteSpace = 'pre-line'; }
  async function load() {
    const response = await fetch('/site/api/website', { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) return;
    const data = await response.json().catch(() => null); const config = data?.config; const current = config?.pages?.[page];
    if (!current) return;
    if (current.browserTitle) document.title = current.browserTitle;
    let meta = qs('meta[name="description"]');
    if (!meta) { meta = document.createElement('meta'); meta.name = 'description'; document.head.append(meta); }
    if (current.description) meta.content = current.description;
    applyHero(current.hero || {});
    applyModules(current.modules || []);
  }

  function heroRoot() {
    if (['guide','releases','account'].includes(page)) return qs('.page-hero');
    if (['issues','support'].includes(page)) return qs('main.support');
    return null;
  }
  function applyHero(hero) {
    const root = heroRoot(); if (!root) return;
    setText(qs('.eyebrow', root), hero.eyebrow);
    const h1 = qs('h1', root); if (h1 && hero.title) setText(h1, hero.title);
    let body = null;
    if (['guide','releases','account'].includes(page)) body = qs(':scope > p', root);
    else body = [...root.children].find((node) => node.tagName === 'P');
    if (body && hero.body) setText(body, hero.body);
  }

  function targetFor(id) {
    if (page === 'guide') {
      const sections = [...document.querySelectorAll('main > section')];
      return id === 'guide-steps' ? sections[1] : id === 'guide-callout' ? sections[2] : null;
    }
    if (page === 'releases') {
      const sections = [...document.querySelectorAll('main > section')];
      return id === 'release-feed' ? sections[1] : null;
    }
    if (page === 'issues') {
      const main = qs('main.support');
      if (id === 'issues-search') return [...(main?.children || [])].find((node) => node.classList?.contains('release-card') && node.id !== 'newIssueCard' && node.id !== 'issueDetail') || null;
      if (id === 'issues-new') return qs('#newIssueCard');
      if (id === 'issues-detail') return qs('#issueDetail');
      if (id === 'issues-list') return qs('#issueListWrap');
    }
    if (page === 'support') {
      if (id === 'support-links') return qs('main.support > .cards');
      if (id === 'support-warning') return qs('main.support > .warn');
    }
    if (page === 'account') {
      if (id === 'account-login') return qs('#loginCard');
      if (id === 'account-dashboard') return qs('.account-layout > section.account-card');
    }
    return null;
  }

  function moduleRoot() {
    if (page === 'guide' || page === 'releases') return qs('main');
    if (page === 'issues' || page === 'support') return qs('main.support');
    if (page === 'account') return qs('.account-layout');
    return null;
  }

  function applyCallout(target, module) {
    if (!target) return;
    setText(qs('h2', target), module.title);
    setText(qs('p', target), module.body);
    const link = qs('a.btn', target);
    if (link) { setText(link, module.buttonLabel); if (module.buttonHref) link.href = module.buttonHref; }
  }

  function applyModules(modules) {
    const sorted = [...modules].sort((a, b) => Number(a.order) - Number(b.order));
    const root = moduleRoot();
    for (const module of sorted) {
      const target = targetFor(module.id); if (!target) continue;
      if (!module.enabled) target.style.display = 'none'; else target.style.removeProperty('display');
      target.dataset.cmsPageModule = module.id;
      if (module.type === 'callout') applyCallout(target, module);
    }
    if (!root || page === 'support') return;
    for (const module of sorted) {
      if (module.lockedOrder) continue;
      const target = targetFor(module.id); if (target && target.parentElement === root) root.append(target);
    }
  }

  void load().catch(() => {});
})();
