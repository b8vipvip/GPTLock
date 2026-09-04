import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PUBLIC = join(ROOT, 'public');

function read(name) { return readFileSync(join(PUBLIC, name), 'utf8'); }

test('public Issues page links to a dedicated composer instead of embedding the old form', () => {
  const html = read('issues.html');
  assert.match(html, /id="newIssueEntry"[^>]+href="\/issues\/new"/);
  assert.match(html, /id="newIssueCard"/, 'CMS protected Issues-new module should still have a stable target');
  assert.doesNotMatch(html, /id="newIssueTitle"/);
  assert.doesNotMatch(html, /id="newIssueBody"/);
});

test('dedicated Issue composer exposes admin-only privacy and keeps local draft support', () => {
  const html = read('issues-new.html');
  const js = read('issues-new.js');
  assert.match(html, /id="newIssueAdminOnly"[^>]+type="checkbox"/);
  assert.match(html, /仅管理员可见/);
  assert.match(html, /不会出现在公开列表、搜索或公开详情页/);
  assert.match(js, /adminOnly:\s*\$\('newIssueAdminOnly'\)\.checked/);
  assert.match(js, /gptwork_issue_draft_v1/);
  assert.match(js, /location\.assign\(`\/issues\?id=/);
  assert.match(js, /issueCreatedPrivate/);
});

test('server exposes the dedicated composer page and script', () => {
  const server = readFileSync(join(ROOT, 'server.mjs'), 'utf8');
  assert.match(server, /'\/issues\/new':'issues-new\.html'/);
  assert.match(server, /url\.pathname === '\/issues-new\.js'/);
});

test('website CMS save controls use compact single-line layout and inset multiline green buttons', () => {
  const css = read('admin-website.css');
  const html = read('admin-website.html');
  assert.match(css, /\.cms-field-save\{[^}]*background:#16a34a!important[^}]*color:#fff!important/);
  assert.match(css, /\.cms-field:not\(:has\(textarea\)\)[^{]*\{[^}]*grid-template-columns:max-content max-content/);
  assert.match(css, /\.cms-field:not\(:has\(textarea\)\)>\.cms-field-footer\{[^}]*grid-column:2[^}]*grid-row:2/);
  assert.match(css, /\.cms-field:has\(textarea\)>\.cms-field-footer\{[^}]*position:absolute[^}]*right:8px[^}]*bottom:8px/);
  assert.match(css, /input\[type=number\]\{width:96px\}/);
  assert.match(css, /#saveWebsite\{[^}]*background:#16a34a!important[^}]*color:#fff!important/);
  assert.match(html, /单行输入框的绿色“保存”位于输入框右侧/);
  assert.match(html, /多行输入框的绿色“保存”位于输入框内部右下角/);
});
