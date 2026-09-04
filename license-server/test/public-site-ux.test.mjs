import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SITE_JS = readFileSync(join(ROOT, 'public', 'site.js'), 'utf8');
const SITE_CSS = readFileSync(join(ROOT, 'public', 'site.css'), 'utf8');

test('legacy default hero badge remains automatic so latest release tag can render', () => {
  assert.match(SITE_JS, /LEGACY_AUTO_RELEASE_BADGE/);
  assert.match(SITE_JS, /customBadge\s*!==\s*LEGACY_AUTO_RELEASE_BADGE/);
  assert.match(SITE_JS, /badge\.dataset\.cmsOverride\s*!==\s*'1'/);
});

test('workflow renderer supports all eight CMS-configurable items', () => {
  assert.match(SITE_JS, /\(module\.items \|\| \[\]\)\.slice\(0, 8\)/);
  assert.match(SITE_JS, /Math\.ceil\(items\.length \/ 2\)/);
  assert.match(SITE_JS, /columns\[0\]\.replaceChildren/);
  assert.match(SITE_JS, /columns\[1\]\.replaceChildren/);
});

test('mobile navigation is expandable and boots before CMS availability', () => {
  assert.match(SITE_JS, /function setupMobileNavigation\(nav\)/);
  assert.match(SITE_JS, /aria-expanded/);
  const bootstrap = SITE_JS.indexOf("setupMobileNavigation(document.querySelector('.site-header .nav-links'));");
  const cmsLoad = SITE_JS.indexOf('void loadWebsiteConfig().catch(() => {});');
  assert.ok(bootstrap >= 0, 'mobile navigation should initialize from static HTML');
  assert.ok(cmsLoad > bootstrap, 'mobile navigation must initialize before the CMS API request');
  assert.match(SITE_CSS, /\.nav-toggle \{ display: none/);
  assert.match(SITE_CSS, /\.nav-links\.is-open \{ display: flex; \}/);
  assert.doesNotMatch(SITE_CSS, /\.nav-links a:not\(\.nav-account\) \{ display: none; \}/);
});

test('footer follows CMS navigation while retaining legal compliance routes', () => {
  assert.match(SITE_JS, /const footerLinks = document\.querySelector\('\.site-footer \.footer-links'\)/);
  for (const route of ['/privacy', '/terms', '/data-deletion']) assert.ok(SITE_JS.includes(route), `footer should retain ${route}`);
});

test('mobile workflow becomes a vertical layout without forced 900px scrolling', () => {
  assert.match(SITE_CSS, /\.mindmap \{ min-width: 0; grid-template-columns: 1fr;/);
  assert.match(SITE_CSS, /\.mindmap::before, \.mindmap::after \{ display: none; \}/);
});
