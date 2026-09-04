import { createHash } from 'node:crypto';

const COOKIE_NAME = 'gptlock_site_session';
class IssuesError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
function nowIso() { return new Date().toISOString(); }
function sha256(value) { return createHash('sha256').update(String(value)).digest('hex'); }
function cookie(req, name) { for (const item of String(req.headers.cookie || '').split(';')) { const [key, ...rest] = item.trim().split('='); if (key === name) return decodeURIComponent(rest.join('=')); } return ''; }
function clampInt(value, min, max, fallback) { const parsed = Number(value); return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback; }
function cleanTitle(value, max) { return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max); }
function cleanBody(value, max) { return String(value || '').replace(/\r\n/g, '\n').trim().slice(0, max); }
function likeTerm(value) { return `%${String(value || '').trim().slice(0, 80).replace(/[\\%_]/g, '\\$&')}%`; }

export function createIssuesSystem({ db, publicOrigin, json, bodyJson }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS support_issues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      author_role TEXT NOT NULL DEFAULT 'user' CHECK(author_role IN ('user','admin')),
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
      pinned INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0,1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS support_issue_replies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      issue_id INTEGER NOT NULL REFERENCES support_issues(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      author_role TEXT NOT NULL CHECK(author_role IN ('user','admin')),
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
  `);

  function ensureIssueAuthorSchema() {
    const columns = db.prepare('PRAGMA table_info(support_issues)').all();
    const userId = columns.find((column) => column.name === 'user_id');
    const authorRole = columns.find((column) => column.name === 'author_role');
    if (authorRole && userId && Number(userId.notnull || 0) === 0) return;
    const roleExpression = authorRole ? "CASE WHEN author_role='admin' THEN 'admin' ELSE 'user' END" : "'user'";
    db.exec('PRAGMA foreign_keys=OFF');
    try {
      db.exec(`BEGIN IMMEDIATE;
        DROP TABLE IF EXISTS support_issues_v2;
        CREATE TABLE support_issues_v2 (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          author_role TEXT NOT NULL DEFAULT 'user' CHECK(author_role IN ('user','admin')),
          title TEXT NOT NULL,
          body TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
          pinned INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0,1)),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;
        INSERT INTO support_issues_v2(id,user_id,author_role,title,body,status,pinned,created_at,updated_at)
          SELECT id,user_id,${roleExpression},title,body,status,pinned,created_at,updated_at FROM support_issues;
        DROP TABLE support_issues;
        ALTER TABLE support_issues_v2 RENAME TO support_issues;
        COMMIT;`);
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch {}
      throw error;
    } finally {
      db.exec('PRAGMA foreign_keys=ON');
    }
    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error('support_issues author migration failed foreign-key validation');
  }
  ensureIssueAuthorSchema();
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_support_issues_activity ON support_issues(pinned DESC,updated_at DESC,id DESC);
    CREATE INDEX IF NOT EXISTS idx_support_issue_replies_issue ON support_issue_replies(issue_id,id);
  `);

  const defaults = { support_issues_enabled:'1', support_issues_create_enabled:'1', support_issues_reply_enabled:'1', support_issues_page_size:'20', support_issues_max_title:'120', support_issues_max_body:'5000', support_issues_max_reply:'3000' };
  const insertSetting = db.prepare('INSERT OR IGNORE INTO app_settings(key,value,updated_at) VALUES(?,?,?)');
  for (const [key, value] of Object.entries(defaults)) insertSetting.run(key, value, nowIso());

  function fail(status, code, message) { throw new IssuesError(status, code, message); }
  function setting(key, fallback) { return db.prepare('SELECT value FROM app_settings WHERE key=?').get(key)?.value ?? fallback; }
  function boolSetting(key, fallback = true) { return setting(key, fallback ? '1' : '0') === '1'; }
  function config() { return {
    enabled: boolSetting('support_issues_enabled'), createEnabled: boolSetting('support_issues_create_enabled'), replyEnabled: boolSetting('support_issues_reply_enabled'),
    pageSize: clampInt(setting('support_issues_page_size','20'),5,50,20), maxTitle: clampInt(setting('support_issues_max_title','120'),40,200,120),
    maxBody: clampInt(setting('support_issues_max_body','5000'),500,20000,5000), maxReply: clampInt(setting('support_issues_max_reply','3000'),200,10000,3000),
  }; }
  function originAllowed(req) { const origin = String(req.headers.origin || ''); return !origin || origin === publicOrigin; }
  function sessionUser(req) {
    const token = cookie(req, COOKIE_NAME); if (!token) return null;
    const row = db.prepare(`SELECT s.id AS session_id,s.user_id,s.expires_at,u.email,u.status FROM site_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.revoked_at IS NULL`).get(sha256(token));
    if (!row || Date.parse(row.expires_at) <= Date.now() || row.status === 'disabled') return null;
    return row;
  }
  function requireUser(req) { const user = sessionUser(req); if (!user) fail(401,'AUTH_REQUIRED','请先登录 GPTWork 账户'); return user; }
  function publicAuthor(userId) { return userId === null || userId === undefined ? '已注销用户' : `用户 #${Number(userId)}`; }
  function issueRow(row, admin = false) {
    const isAdmin = row.author_role === 'admin';
    const author = isAdmin
      ? { label:'GPTWork 管理员' }
      : (admin ? { id:row.user_id, email:row.email || '', label:publicAuthor(row.user_id) } : { label:publicAuthor(row.user_id) });
    return { id:row.id, title:row.title, body:row.body, status:row.status, pinned:Boolean(row.pinned), authorRole:isAdmin?'admin':'user', replyCount:Number(row.reply_count || 0), createdAt:row.created_at, updatedAt:row.updated_at, author };
  }
  function replyRow(row, admin = false) {
    const isAdmin = row.author_role === 'admin';
    return { id:row.id, body:row.body, authorRole:row.author_role, author:isAdmin ? { label:'GPTWork 管理员' } : (admin ? { id:row.user_id, email:row.email || '', label:publicAuthor(row.user_id) } : { label:publicAuthor(row.user_id) }), createdAt:row.created_at, updatedAt:row.updated_at };
  }
  const issueSelect = `SELECT i.*,u.email,(SELECT COUNT(*) FROM support_issue_replies r WHERE r.issue_id=i.id) AS reply_count FROM support_issues i LEFT JOIN users u ON u.id=i.user_id`;
  function getIssue(id, admin = false) { const row = db.prepare(`${issueSelect} WHERE i.id=?`).get(id); return row ? issueRow(row, admin) : null; }
  function getReplies(id, admin = false) { return db.prepare(`SELECT r.*,u.email FROM support_issue_replies r LEFT JOIN users u ON u.id=r.user_id WHERE r.issue_id=? ORDER BY r.id`).all(id).map((row) => replyRow(row, admin)); }
  function rateCheck(kind, userId, max, minutes) {
    const since = new Date(Date.now() - minutes * 60000).toISOString();
    const row = kind === 'issue'
      ? db.prepare("SELECT COUNT(*) AS count FROM support_issues WHERE user_id=? AND author_role='user' AND created_at>=?").get(userId,since)
      : db.prepare("SELECT COUNT(*) AS count FROM support_issue_replies WHERE user_id=? AND author_role='user' AND created_at>=?").get(userId,since);
    if (Number(row?.count || 0) >= max) fail(429,'RATE_LIMITED','提交过于频繁，请稍后再试');
  }
  function validateIssueInput(input, cfg, fallback = null) {
    const title = input.title === undefined && fallback ? fallback.title : cleanTitle(input.title, cfg.maxTitle);
    const body = input.body === undefined && fallback ? fallback.body : cleanBody(input.body, cfg.maxBody);
    const status = ['open','closed'].includes(input.status) ? input.status : (fallback?.status || 'open');
    const pinned = input.pinned === undefined ? Boolean(fallback?.pinned) : Boolean(input.pinned);
    if (title.length < 4) fail(400,'TITLE_TOO_SHORT','标题至少 4 个字符');
    if (body.length < 10) fail(400,'BODY_TOO_SHORT','问题描述至少 10 个字符');
    return { title, body, status, pinned };
  }
  function sendError(res,error) { if (error instanceof IssuesError) { json(res,error.status,{ok:false,error:{code:error.code,message:error.message}}); return true; } throw error; }

  async function handleSite(req,res,url) {
    if (!url.pathname.startsWith('/site/api/issues')) return false;
    try {
      const cfg = config(); if (!cfg.enabled) fail(503,'ISSUES_DISABLED','Issues 讨论区暂时关闭');
      if (!['GET','HEAD'].includes(req.method || '') && !originAllowed(req)) fail(403,'ORIGIN_MISMATCH','请求来源校验失败');
      if (url.pathname === '/site/api/issues/config' && req.method === 'GET') { json(res,200,{ok:true,config:cfg,authenticated:Boolean(sessionUser(req))}); return true; }
      if (url.pathname === '/site/api/issues' && req.method === 'GET') {
        const page=clampInt(url.searchParams.get('page'),1,100000,1); const status=['open','closed'].includes(url.searchParams.get('status'))?url.searchParams.get('status'):'all'; const q=String(url.searchParams.get('q')||'').trim(); const where=[]; const params=[];
        if(status!=='all'){where.push('i.status=?');params.push(status);} if(q){where.push("(i.title LIKE ? ESCAPE '\\' OR i.body LIKE ? ESCAPE '\\')");const term=likeTerm(q);params.push(term,term);} const clause=where.length?`WHERE ${where.join(' AND ')}`:'';
        const total=Number(db.prepare(`SELECT COUNT(*) AS count FROM support_issues i ${clause}`).get(...params)?.count||0);
        const rows=db.prepare(`${issueSelect} ${clause} ORDER BY i.pinned DESC,i.updated_at DESC,i.id DESC LIMIT ? OFFSET ?`).all(...params,cfg.pageSize,(page-1)*cfg.pageSize).map((row)=>issueRow(row));
        json(res,200,{ok:true,issues:rows,page,pageSize:cfg.pageSize,total}); return true;
      }
      if (url.pathname === '/site/api/issues' && req.method === 'POST') {
        if(!cfg.createEnabled) fail(403,'CREATE_DISABLED','当前暂停新建问题');
        const user=requireUser(req); rateCheck('issue',user.user_id,5,10); const input=await bodyJson(req); const next=validateIssueInput(input,cfg); const now=nowIso();
        const result=db.prepare("INSERT INTO support_issues(user_id,author_role,title,body,status,pinned,created_at,updated_at) VALUES(?,'user',?,?,?,?,?,?)").run(user.user_id,next.title,next.body,'open',0,now,now);
        json(res,201,{ok:true,issue:getIssue(Number(result.lastInsertRowid))}); return true;
      }
      const detail=url.pathname.match(/^\/site\/api\/issues\/(\d+)$/);
      if(detail&&req.method==='GET'){const id=Number(detail[1]);const issue=getIssue(id);if(!issue)fail(404,'ISSUE_NOT_FOUND','问题不存在');json(res,200,{ok:true,issue,replies:getReplies(id),authenticated:Boolean(sessionUser(req))});return true;}
      const reply=url.pathname.match(/^\/site\/api\/issues\/(\d+)\/replies$/);
      if(reply&&req.method==='POST'){
        if(!cfg.replyEnabled)fail(403,'REPLY_DISABLED','当前暂停用户回复');const user=requireUser(req);const id=Number(reply[1]);const issue=getIssue(id);if(!issue)fail(404,'ISSUE_NOT_FOUND','问题不存在');if(issue.status==='closed')fail(409,'ISSUE_CLOSED','该问题已关闭，不能继续回复');rateCheck('reply',user.user_id,20,10);const input=await bodyJson(req);const body=cleanBody(input.body,cfg.maxReply);if(body.length<2)fail(400,'REPLY_TOO_SHORT','回复内容至少 2 个字符');const now=nowIso();
        db.exec('BEGIN IMMEDIATE');try{db.prepare("INSERT INTO support_issue_replies(issue_id,user_id,author_role,body,created_at,updated_at) VALUES(?,?,'user',?,?,?)").run(id,user.user_id,body,now,now);db.prepare('UPDATE support_issues SET updated_at=? WHERE id=?').run(now,id);db.exec('COMMIT');}catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}json(res,201,{ok:true,issue:getIssue(id),replies:getReplies(id)});return true;
      }
      fail(404,'NOT_FOUND','Not found');
    } catch(error) { return sendError(res,error); }
  }

  async function handleAdmin(req,res,url) {
    if (!url.pathname.startsWith('/admin/api/issues')) return false;
    try {
      if(url.pathname==='/admin/api/issues/config'&&req.method==='GET'){json(res,200,{ok:true,config:config()});return true;}
      if(url.pathname==='/admin/api/issues/config'&&req.method==='PUT'){
        const input=await bodyJson(req);const next={support_issues_enabled:input.enabled?'1':'0',support_issues_create_enabled:input.createEnabled?'1':'0',support_issues_reply_enabled:input.replyEnabled?'1':'0',support_issues_page_size:String(clampInt(input.pageSize,5,50,20)),support_issues_max_title:String(clampInt(input.maxTitle,40,200,120)),support_issues_max_body:String(clampInt(input.maxBody,500,20000,5000)),support_issues_max_reply:String(clampInt(input.maxReply,200,10000,3000))};const upsert=db.prepare(`INSERT INTO app_settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`);const now=nowIso();db.exec('BEGIN IMMEDIATE');try{for(const [key,value] of Object.entries(next))upsert.run(key,value,now);db.exec('COMMIT');}catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}json(res,200,{ok:true,config:config()});return true;
      }
      if(url.pathname==='/admin/api/issues'&&req.method==='GET'){
        const cfg=config();const page=clampInt(url.searchParams.get('page'),1,100000,1);const status=['open','closed'].includes(url.searchParams.get('status'))?url.searchParams.get('status'):'all';const q=String(url.searchParams.get('q')||'').trim();const where=[];const params=[];if(status!=='all'){where.push('i.status=?');params.push(status);}if(q){where.push("(i.title LIKE ? ESCAPE '\\' OR i.body LIKE ? ESCAPE '\\' OR COALESCE(u.email,'') LIKE ? ESCAPE '\\')");const term=likeTerm(q);params.push(term,term,term);}const clause=where.length?`WHERE ${where.join(' AND ')}`:'';const total=Number(db.prepare(`SELECT COUNT(*) AS count FROM support_issues i LEFT JOIN users u ON u.id=i.user_id ${clause}`).get(...params)?.count||0);const rows=db.prepare(`${issueSelect} ${clause} ORDER BY i.pinned DESC,i.updated_at DESC,i.id DESC LIMIT ? OFFSET ?`).all(...params,cfg.pageSize,(page-1)*cfg.pageSize).map((row)=>issueRow(row,true));json(res,200,{ok:true,issues:rows,page,pageSize:cfg.pageSize,total});return true;
      }
      if(url.pathname==='/admin/api/issues'&&req.method==='POST'){
        const cfg=config();const input=await bodyJson(req);const next=validateIssueInput(input,cfg);const now=nowIso();
        const result=db.prepare("INSERT INTO support_issues(user_id,author_role,title,body,status,pinned,created_at,updated_at) VALUES(NULL,'admin',?,?,?,?,?,?)").run(next.title,next.body,next.status,next.pinned?1:0,now,now);
        json(res,201,{ok:true,issue:getIssue(Number(result.lastInsertRowid),true),replies:[]});return true;
      }
      const detail=url.pathname.match(/^\/admin\/api\/issues\/(\d+)$/);
      if(detail&&req.method==='GET'){const id=Number(detail[1]);const issue=getIssue(id,true);if(!issue)fail(404,'ISSUE_NOT_FOUND','问题不存在');json(res,200,{ok:true,issue,replies:getReplies(id,true)});return true;}
      if(detail&&req.method==='PATCH'){const id=Number(detail[1]);const current=getIssue(id,true);if(!current)fail(404,'ISSUE_NOT_FOUND','问题不存在');const input=await bodyJson(req);const next=validateIssueInput(input,config(),current);db.prepare('UPDATE support_issues SET title=?,body=?,status=?,pinned=?,updated_at=? WHERE id=?').run(next.title,next.body,next.status,next.pinned?1:0,nowIso(),id);json(res,200,{ok:true,issue:getIssue(id,true),replies:getReplies(id,true)});return true;}
      if(detail&&req.method==='DELETE'){const id=Number(detail[1]);const result=db.prepare('DELETE FROM support_issues WHERE id=?').run(id);if(!result.changes)fail(404,'ISSUE_NOT_FOUND','问题不存在');json(res,200,{ok:true});return true;}
      const reply=url.pathname.match(/^\/admin\/api\/issues\/(\d+)\/replies$/);
      if(reply&&req.method==='POST'){const id=Number(reply[1]);if(!getIssue(id,true))fail(404,'ISSUE_NOT_FOUND','问题不存在');const input=await bodyJson(req);const body=cleanBody(input.body,config().maxReply);if(body.length<2)fail(400,'REPLY_TOO_SHORT','回复内容至少 2 个字符');const now=nowIso();db.exec('BEGIN IMMEDIATE');try{db.prepare("INSERT INTO support_issue_replies(issue_id,user_id,author_role,body,created_at,updated_at) VALUES(?,NULL,'admin',?,?,?)").run(id,body,now,now);db.prepare('UPDATE support_issues SET updated_at=? WHERE id=?').run(now,id);db.exec('COMMIT');}catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}json(res,201,{ok:true,issue:getIssue(id,true),replies:getReplies(id,true)});return true;}
      const deleteReply=url.pathname.match(/^\/admin\/api\/issues\/(\d+)\/replies\/(\d+)$/);
      if(deleteReply&&req.method==='DELETE'){const issueId=Number(deleteReply[1]);const replyId=Number(deleteReply[2]);const result=db.prepare('DELETE FROM support_issue_replies WHERE id=? AND issue_id=?').run(replyId,issueId);if(!result.changes)fail(404,'REPLY_NOT_FOUND','回复不存在');db.prepare('UPDATE support_issues SET updated_at=? WHERE id=?').run(nowIso(),issueId);json(res,200,{ok:true,issue:getIssue(issueId,true),replies:getReplies(issueId,true)});return true;}
      fail(404,'NOT_FOUND','Not found');
    } catch(error) { return sendError(res,error); }
  }
  return { handleSite, handleAdmin, config };
}
