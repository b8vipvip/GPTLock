const $ = (id) => document.getElementById(id);
const state = { page: 1, pageSize: 20, total: 0, status: 'all', q: '', authenticated: false, config: null, detailId: null };

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', headers: { 'content-type': 'application/json', ...(options.headers || {}) }, ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) { const error = new Error(body.error?.message || `HTTP ${response.status}`); error.status = response.status; error.code = body.error?.code; throw error; }
  return body;
}
function localDate(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString(); }
function setText(id, value) { const node = $(id); if (node) node.textContent = String(value ?? ''); }
function clear(node) { while (node.firstChild) node.firstChild.remove(); }
function button(label, className, handler) { const node = document.createElement('button'); node.type = 'button'; node.className = className; node.textContent = label; node.addEventListener('click', handler); return node; }
function badge(issue) { const node = document.createElement('span'); node.className = 'release-tag'; node.textContent = issue.status === 'closed' ? 'CLOSED' : (issue.pinned ? 'PINNED · OPEN' : 'OPEN'); return node; }

function renderIssueCard(issue) {
  const card = document.createElement('article'); card.className = 'release-card';
  const top = document.createElement('div'); top.className = 'release-top';
  const info = document.createElement('div'); info.append(badge(issue));
  const title = document.createElement('h2'); title.textContent = `#${issue.id} ${issue.title}`; info.append(title);
  const meta = document.createElement('p'); meta.className = 'release-date'; meta.textContent = `${issue.author?.label || '用户'} · ${localDate(issue.createdAt)} · ${issue.replyCount} 条回复`; info.append(meta);
  const open = button('打开讨论 →', 'btn btn-soft', () => openIssue(issue.id)); top.append(info, open);
  const preview = document.createElement('p'); preview.textContent = issue.body.length > 180 ? `${issue.body.slice(0, 180)}…` : issue.body;
  card.append(top, preview); return card;
}

async function loadConfig() {
  const data = await api('/site/api/issues/config'); state.config = data.config; state.authenticated = Boolean(data.authenticated);
  const entry = $('newIssueEntry'); if (entry) { entry.hidden = !data.config.createEnabled; entry.setAttribute('aria-disabled', data.config.createEnabled ? 'false' : 'true'); }
  const login = $('issuesLogin'); if (login) login.hidden = state.authenticated;
  setText('issuesState', state.authenticated ? '已登录 · 可以新建 Issue 和参与解答' : '公开浏览 · 新建 Issue 时需要先登录 GPTWork 账户');
}
async function loadIssues() {
  state.detailId = null; $('issueDetail').hidden = true; $('issueListWrap').hidden = false;
  const params = new URLSearchParams({ page: String(state.page), status: state.status }); if (state.q) params.set('q', state.q);
  const data = await api(`/site/api/issues?${params}`); state.pageSize = data.pageSize; state.total = data.total;
  clear($('issueList')); for (const issue of data.issues) $('issueList').append(renderIssueCard(issue));
  if (!data.issues.length) { const empty = document.createElement('article'); empty.className = 'release-card'; empty.textContent = '暂时没有符合条件的公开 Issue。'; $('issueList').append(empty); }
  const pages = Math.max(1, Math.ceil(state.total / state.pageSize)); setText('pageState', `第 ${state.page} / ${pages} 页 · 共 ${state.total} 个公开 Issues`);
  $('prevPage').disabled = state.page <= 1; $('nextPage').disabled = state.page >= pages;
  history.replaceState(null, '', state.page === 1 && !state.q && state.status === 'all' ? '/issues' : `/issues?${params}`);
}

function renderReply(reply) {
  const card = document.createElement('article'); card.className = 'release-card';
  const meta = document.createElement('p'); meta.className = 'release-date'; meta.textContent = `${reply.author?.label || '用户'} · ${localDate(reply.createdAt)}`;
  const body = document.createElement('div'); body.className = 'release-notes'; body.textContent = reply.body;
  card.append(meta, body); return card;
}
async function openIssue(id) {
  const data = await api(`/site/api/issues/${id}`); state.detailId = id; state.authenticated = Boolean(data.authenticated);
  $('issueListWrap').hidden = true; $('issueDetail').hidden = false;
  $('detailStatus').textContent = data.issue.status === 'closed' ? 'CLOSED' : (data.issue.pinned ? 'PINNED · OPEN' : 'OPEN');
  setText('detailTitle', `#${data.issue.id} ${data.issue.title}`); setText('detailMeta', `${data.issue.author?.label || '用户'} · ${localDate(data.issue.createdAt)} · ${data.issue.replyCount} 条回复`); setText('detailBody', data.issue.body);
  clear($('replyList')); for (const reply of data.replies) $('replyList').append(renderReply(reply));
  if (!data.replies.length) { const empty = document.createElement('p'); empty.className = 'release-date'; empty.textContent = '还没有回复。'; $('replyList').append(empty); }
  $('replyComposer').hidden = !(state.authenticated && state.config?.replyEnabled && data.issue.status === 'open');
  history.replaceState(null, '', `/issues?id=${id}`); window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function sendReply() {
  if (!state.detailId) return; const body = $('replyBody').value.trim(); const buttonNode = $('sendReply'); buttonNode.disabled = true; setText('replyMessage', '正在回复…');
  try { await api(`/site/api/issues/${state.detailId}/replies`, { method: 'POST', body: JSON.stringify({ body }) }); $('replyBody').value = ''; setText('replyMessage', '回复成功。'); await openIssue(state.detailId); }
  catch (error) { setText('replyMessage', error.message); }
  finally { buttonNode.disabled = false; }
}
function applyFilter(status) { state.status = status; state.q = $('issueSearch').value.trim(); state.page = 1; void loadIssues().catch(showFatal); }
function showFatal(error) { setText('issuesState', `讨论区暂不可用：${error.message}`); }

$('searchIssues').addEventListener('click', () => applyFilter(state.status));
$('issueSearch').addEventListener('keydown', (event) => { if (event.key === 'Enter') applyFilter(state.status); });
$('showAllIssues').addEventListener('click', () => applyFilter('all'));
$('showOpenIssues').addEventListener('click', () => applyFilter('open'));
$('showClosedIssues').addEventListener('click', () => applyFilter('closed'));
$('prevPage').addEventListener('click', () => { if (state.page > 1) { state.page -= 1; void loadIssues().catch(showFatal); } });
$('nextPage').addEventListener('click', () => { if (state.page * state.pageSize < state.total) { state.page += 1; void loadIssues().catch(showFatal); } });
$('sendReply').addEventListener('click', () => void sendReply());
$('backToIssues').addEventListener('click', () => void loadIssues().catch(showFatal));

(async () => {
  try {
    const params = new URLSearchParams(location.search); state.q = params.get('q') || ''; state.status = ['open','closed'].includes(params.get('status')) ? params.get('status') : 'all'; state.page = Math.max(1, Number(params.get('page') || 1) || 1); $('issueSearch').value = state.q;
    await loadConfig(); const id = Number(params.get('id')); if (Number.isInteger(id) && id > 0) await openIssue(id); else await loadIssues();
  } catch (error) { showFatal(error); }
})();
