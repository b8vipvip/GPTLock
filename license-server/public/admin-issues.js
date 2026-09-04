const $ = (id) => document.getElementById(id);
const state = { current: null, replies: [], config: null };

async function api(path, options = {}) {
  const response = await fetch(path,{credentials:'same-origin',cache:'no-store',headers:{'content-type':'application/json',...(options.headers||{})},...options});
  const body=await response.json().catch(()=>({}));
  if(!response.ok||body.ok===false){const error=new Error(body.error?.message||`HTTP ${response.status}`);error.status=response.status;error.code=body.error?.code||null;throw error;}
  return body;
}
function message(node,text,tone=''){if(!node)return;node.textContent=text||'';node.className=`message ${tone}`.trim();}
function localDate(value){const d=new Date(value);return Number.isNaN(d.getTime())?'—':d.toLocaleString('zh-CN',{hour12:false});}
function td(text){const node=document.createElement('td');node.textContent=String(text??'');return node;}
function action(label,handler,className=''){const node=document.createElement('button');node.type='button';node.textContent=label;if(className)node.className=className;node.addEventListener('click',handler);return node;}
function arm(node,label='再次点击确认'){if(Number(node.dataset.confirmUntil||0)>Date.now()){node.dataset.confirmUntil='0';return true;}const original=node.textContent;node.dataset.confirmUntil=String(Date.now()+4000);node.textContent=label;setTimeout(()=>{if(Number(node.dataset.confirmUntil||0)<=Date.now()){node.textContent=original;node.dataset.confirmUntil='0';}},4100);return false;}
function authorText(issue){return issue.author?.email||issue.author?.label||(issue.authorRole==='admin'?'GPTWork 管理员':'用户');}
function limits(){return state.config||{maxTitle:120,maxBody:5000,maxReply:3000};}
function countText(node,value,max){if(node)node.textContent=`${String(value||'').length} / ${max}`;}
function preview(node,value,empty='开始输入后这里会显示正文预览。'){if(node)node.textContent=String(value||'').trim()||empty;}
function syncCreateEditor(){const cfg=limits();$('createTitle').maxLength=cfg.maxTitle;$('createBody').maxLength=cfg.maxBody;countText($('createTitleCount'),$('createTitle').value,cfg.maxTitle);countText($('createBodyCount'),$('createBody').value,cfg.maxBody);preview($('createPreview'),$('createBody').value);}
function syncEditEditor(){const cfg=limits();$('editTitle').maxLength=cfg.maxTitle;$('editBody').maxLength=cfg.maxBody;countText($('editTitleCount'),$('editTitle').value,cfg.maxTitle);countText($('editBodyCount'),$('editBody').value,cfg.maxBody);preview($('editPreview'),$('editBody').value,'正文为空');}
function syncReplyEditor(){const cfg=limits();$('adminReply').maxLength=cfg.maxReply;countText($('replyCount'),$('adminReply').value,cfg.maxReply);}

async function authenticate(){
  try{await api('/admin/api/account/dashboard');$('login').hidden=true;$('app').hidden=false;$('logout').hidden=false;await loadConfig();await loadIssues();}
  catch(error){if(error.status===401){$('app').hidden=true;$('login').hidden=false;$('logout').hidden=true;}else message($('loginMessage'),error.message,'bad');}
}
async function loadConfig(){
  const {config}=await api('/admin/api/issues/config');state.config=config;
  $('issuesEnabled').checked=config.enabled;$('createEnabled').checked=config.createEnabled;$('replyEnabled').checked=config.replyEnabled;$('pageSize').value=config.pageSize;$('maxTitle').value=config.maxTitle;$('maxBody').value=config.maxBody;$('maxReply').value=config.maxReply;
  syncCreateEditor();syncEditEditor();syncReplyEditor();
}
async function saveConfig(){
  const body={enabled:$('issuesEnabled').checked,createEnabled:$('createEnabled').checked,replyEnabled:$('replyEnabled').checked,pageSize:Number($('pageSize').value),maxTitle:Number($('maxTitle').value),maxBody:Number($('maxBody').value),maxReply:Number($('maxReply').value)};
  const result=await api('/admin/api/issues/config',{method:'PUT',body:JSON.stringify(body)});state.config=result.config;
  $('pageSize').value=result.config.pageSize;$('maxTitle').value=result.config.maxTitle;$('maxBody').value=result.config.maxBody;$('maxReply').value=result.config.maxReply;syncCreateEditor();syncEditEditor();syncReplyEditor();message($('configMessage'),'参数已保存。','good');
}
function renderIssues(rows,total){
  $('issuesBody').textContent='';
  for(const issue of rows){
    const tr=document.createElement('tr');
    const status=`${issue.pinned?'置顶 · ':''}${issue.status}`;
    tr.append(td(issue.id),td(status),td(issue.title),td(authorText(issue)),td(issue.replyCount),td(localDate(issue.updatedAt)));
    const actions=document.createElement('td');actions.append(action('管理',()=>void openIssue(issue.id),'primary'));tr.append(actions);$('issuesBody').append(tr);
  }
  if(!rows.length){const tr=document.createElement('tr');const cell=document.createElement('td');cell.colSpan=7;cell.textContent='暂无符合条件的帖子';tr.append(cell);$('issuesBody').append(tr);}
  $('listState').textContent=`共 ${total} 个 Issues`;
}
async function loadIssues(){const params=new URLSearchParams({status:$('issueStatus').value||'all'});const q=$('issueSearch').value.trim();if(q)params.set('q',q);const data=await api(`/admin/api/issues?${params}`);renderIssues(data.issues,data.total);}

function openCreate(){
  $('createCard').hidden=false;$('createTitle').value='';$('createBody').value='';$('createStatus').value='open';$('createPinned').checked=false;message($('createMessage'),'');syncCreateEditor();$('createCard').scrollIntoView({behavior:'smooth',block:'start'});$('createTitle').focus();
}
function closeCreate(){$('createCard').hidden=true;message($('createMessage'),'');}
function insertCreateTemplate(){
  if($('createBody').value.trim()&&!arm($('createTemplate'),'再次点击覆盖正文'))return;
  $('createBody').value='背景：\n\n结论：\n\n影响范围：\n\n处理方式 / 操作步骤：\n1. \n2. \n3. \n\n注意事项：\n\n如有问题，请在本帖回复。';syncCreateEditor();$('createBody').focus();
}
async function createAdminIssue(){
  const button=$('createIssue');button.disabled=true;message($('createMessage'),'正在发布管理员帖子…');
  try{
    const data=await api('/admin/api/issues',{method:'POST',body:JSON.stringify({title:$('createTitle').value,body:$('createBody').value,status:$('createStatus').value,pinned:$('createPinned').checked})});
    closeCreate();await loadIssues();await openIssue(data.issue.id);message($('detailMessage'),'管理员帖子已发布并立即出现在官网 Issues 讨论区。','good');
  }catch(error){message($('createMessage'),error.message,'bad');}
  finally{button.disabled=false;}
}

function renderReplies(){
  const wrap=$('replies');wrap.textContent='';
  for(const reply of state.replies){
    const row=document.createElement('div');row.className='module-editor';
    const meta=document.createElement('p');meta.className='muted';meta.textContent=`${reply.author?.label||'用户'}${reply.author?.email?` · ${reply.author.email}`:''} · ${localDate(reply.createdAt)}`;
    const body=document.createElement('pre');body.className='logbox';body.textContent=reply.body;
    const remove=action('删除回复',async()=>{if(!arm(remove,'再次点击删除'))return;remove.disabled=true;try{const data=await api(`/admin/api/issues/${state.current.id}/replies/${reply.id}`,{method:'DELETE',body:'{}'});state.replies=data.replies;renderReplies();await loadIssues();message($('replyMessage'),'回复已删除。','good');}catch(error){message($('replyMessage'),error.message,'bad');}finally{remove.disabled=false;}},'danger');
    const controls=document.createElement('div');controls.className='section-actions';controls.append(remove);row.append(meta,body,controls);wrap.append(row);
  }
  if(!state.replies.length){const p=document.createElement('p');p.className='muted';p.textContent='暂无回复';wrap.append(p);}
}
function renderDetail(data){
  state.current=data.issue;state.replies=data.replies;$('detailCard').hidden=false;
  $('detailTitle').textContent=`#${data.issue.id} ${data.issue.title}`;$('detailMeta').textContent=`${authorText(data.issue)} · ${localDate(data.issue.createdAt)} · ${data.issue.replyCount} 条回复`;
  $('editTitle').value=data.issue.title;$('editBody').value=data.issue.body;$('editStatus').value=data.issue.status;$('editPinned').checked=Boolean(data.issue.pinned);$('openPublicIssue').href=`/issues?id=${data.issue.id}`;
  syncEditEditor();renderReplies();syncReplyEditor();
}
async function openIssue(id){renderDetail(await api(`/admin/api/issues/${id}`));message($('detailMessage'),'');$('detailCard').scrollIntoView({behavior:'smooth',block:'start'});}
async function patchIssue(){
  if(!state.current)return;const button=$('saveIssue');button.disabled=true;message($('detailMessage'),'正在保存…');
  try{const data=await api(`/admin/api/issues/${state.current.id}`,{method:'PATCH',body:JSON.stringify({title:$('editTitle').value,body:$('editBody').value,status:$('editStatus').value,pinned:$('editPinned').checked})});renderDetail(data);await loadIssues();message($('detailMessage'),'帖子已保存，官网立即生效。','good');}
  finally{button.disabled=false;}
}
async function adminReply(){
  if(!state.current)return;const button=$('sendAdminReply');button.disabled=true;message($('replyMessage'),'正在发布回复…');
  try{const data=await api(`/admin/api/issues/${state.current.id}/replies`,{method:'POST',body:JSON.stringify({body:$('adminReply').value})});$('adminReply').value='';renderDetail(data);await loadIssues();message($('replyMessage'),'管理员回复已发布。','good');}
  finally{button.disabled=false;}
}

$('loginButton').addEventListener('click',async()=>{try{await api('/admin/api/login',{method:'POST',body:JSON.stringify({password:$('password').value})});$('password').value='';message($('loginMessage'),'');await authenticate();}catch(error){message($('loginMessage'),error.message,'bad');}});
$('password').addEventListener('keydown',(event)=>{if(event.key==='Enter')$('loginButton').click();});
$('logout').addEventListener('click',async()=>{await api('/admin/api/logout',{method:'POST',body:'{}'}).catch(()=>{});location.reload();});
$('saveConfig').addEventListener('click',()=>void saveConfig().catch((error)=>message($('configMessage'),error.message,'bad')));
$('refreshIssues').addEventListener('click',()=>void loadIssues().catch((error)=>message($('listState'),error.message,'bad')));
$('searchIssues').addEventListener('click',()=>void loadIssues().catch((error)=>message($('listState'),error.message,'bad')));
$('issueSearch').addEventListener('keydown',(event)=>{if(event.key==='Enter')void loadIssues();});$('issueStatus').addEventListener('change',()=>void loadIssues());
$('newAdminIssue').addEventListener('click',openCreate);$('cancelCreate').addEventListener('click',closeCreate);$('createTemplate').addEventListener('click',insertCreateTemplate);$('createIssue').addEventListener('click',()=>void createAdminIssue());
$('createTitle').addEventListener('input',syncCreateEditor);$('createBody').addEventListener('input',syncCreateEditor);$('editTitle').addEventListener('input',syncEditEditor);$('editBody').addEventListener('input',syncEditEditor);$('adminReply').addEventListener('input',syncReplyEditor);
$('saveIssue').addEventListener('click',()=>void patchIssue().catch((error)=>message($('detailMessage'),error.message,'bad')));
$('editTitle').addEventListener('keydown',(event)=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();$('saveIssue').click();}});
$('editBody').addEventListener('keydown',(event)=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();$('saveIssue').click();}});
$('sendAdminReply').addEventListener('click',()=>void adminReply().catch((error)=>message($('replyMessage'),error.message,'bad')));
$('deleteIssue').addEventListener('click',async()=>{const node=$('deleteIssue');if(!state.current||!arm(node,'再次点击删除帖子'))return;node.disabled=true;try{await api(`/admin/api/issues/${state.current.id}`,{method:'DELETE',body:'{}'});state.current=null;state.replies=[];$('detailCard').hidden=true;await loadIssues();}catch(error){message($('detailMessage'),error.message,'bad');}finally{node.disabled=false;}});
void authenticate();
