const $ = (id) => document.getElementById(id);
const DRAFT_KEY = 'gptwork_issue_draft_v1';
let config = null;

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', headers: { 'content-type': 'application/json', ...(options.headers || {}) }, ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) { const error = new Error(body.error?.message || `HTTP ${response.status}`); error.status = response.status; error.code = body.error?.code; throw error; }
  return body;
}
function text(id, value) { const node = $(id); if (node) node.textContent = String(value ?? ''); }
function draft() { return { title: $('newIssueTitle').value, body: $('newIssueBody').value, adminOnly: $('newIssueAdminOnly').checked }; }
function saveLocalDraft() { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft())); } catch {} }
function clearLocalDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch {} }
function restoreLocalDraft() {
  try {
    const saved = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); if (!saved || typeof saved !== 'object') return;
    $('newIssueTitle').value = String(saved.title || ''); $('newIssueBody').value = String(saved.body || ''); $('newIssueAdminOnly').checked = Boolean(saved.adminOnly);
  } catch {}
}
function syncEditor() {
  const maxTitle = Number(config?.maxTitle || 120); const maxBody = Number(config?.maxBody || 5000);
  $('newIssueTitle').maxLength = maxTitle; $('newIssueBody').maxLength = maxBody;
  text('newIssueTitleCount', `${$('newIssueTitle').value.length} / ${maxTitle}`); text('newIssueBodyCount', `${$('newIssueBody').value.length} / ${maxBody}`);
  text('newIssuePreview', $('newIssueBody').value.trim() || '开始输入后这里会显示正文预览。'); saveLocalDraft();
}
async function createIssue() {
  const button = $('createIssue'); button.disabled = true; text('newIssueMessage', '正在提交…');
  try {
    const payload = { title: $('newIssueTitle').value.trim(), body: $('newIssueBody').value.trim(), adminOnly: $('newIssueAdminOnly').checked };
    const data = await api('/site/api/issues', { method: 'POST', body: JSON.stringify(payload) }); clearLocalDraft();
    if (data.issue?.adminOnly) {
      $('issueComposer').hidden = true; $('issueCreatedPrivate').hidden = false; text('privateIssueCreatedTitle', `Issue #${data.issue.id} 已提交`); window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      location.assign(`/issues?id=${encodeURIComponent(data.issue.id)}`);
    }
  } catch (error) { text('newIssueMessage', error.message); }
  finally { button.disabled = false; }
}

$('newIssueTitle').addEventListener('input', syncEditor); $('newIssueBody').addEventListener('input', syncEditor); $('newIssueAdminOnly').addEventListener('change', syncEditor);
$('createIssue').addEventListener('click', () => void createIssue());
for (const id of ['newIssueTitle','newIssueBody']) $(id).addEventListener('keydown', (event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); $('createIssue').click(); } });

(async () => {
  try {
    const data = await api('/site/api/issues/config'); config = data.config;
    if (!data.config.createEnabled) { $('issueCreateDisabled').hidden = false; return; }
    if (!data.authenticated) { $('issueAuthRequired').hidden = false; return; }
    restoreLocalDraft(); $('issueComposer').hidden = false; syncEditor(); $('newIssueTitle').focus();
  } catch (error) { $('issueCreateDisabled').hidden = false; text('issueCreateDisabledMessage', `讨论区暂不可用：${error.message}`); }
})();
