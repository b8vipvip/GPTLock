import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createIssuesSystem } from '../issues-system.mjs';

function sha256(value) { return createHash('sha256').update(String(value)).digest('hex'); }
function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE users(id INTEGER PRIMARY KEY,email TEXT NOT NULL,status TEXT NOT NULL) STRICT;
    CREATE TABLE site_sessions(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,token_hash TEXT NOT NULL,expires_at TEXT NOT NULL,revoked_at TEXT) STRICT;
    CREATE TABLE app_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL) STRICT;`);
  db.prepare('INSERT INTO users(id,email,status) VALUES(1,?,?)').run('alice@example.com','active');
  db.prepare('INSERT INTO users(id,email,status) VALUES(2,?,?)').run('bob@example.com','active');
  const expires = new Date(Date.now()+86400000).toISOString();
  db.prepare('INSERT INTO site_sessions(id,user_id,token_hash,expires_at,revoked_at) VALUES(1,1,?,?,NULL)').run(sha256('alice-token'),expires);
  db.prepare('INSERT INTO site_sessions(id,user_id,token_hash,expires_at,revoked_at) VALUES(2,2,?,?,NULL)').run(sha256('bob-token'),expires);
  const json = (res,status,body) => { res.status=status; res.body=body; };
  const bodyJson = async (req) => req.body || {};
  const system = createIssuesSystem({db,publicOrigin:'https://gptwork.test',json,bodyJson});
  return {db,system};
}
function req(method, token='', body={}) { return {method,body,headers:{origin:'https://gptwork.test',cookie:token?`gptlock_site_session=${token}`:''}}; }
function url(path) { return new URL(path,'https://gptwork.test'); }
async function site(system, method, path, token='', body={}) { const res={}; const handled=await system.handleSite(req(method,token,body),res,url(path)); assert.equal(handled,true); return res; }
async function admin(system, method, path, body={}) { const res={}; const handled=await system.handleAdmin(req(method,'',body),res,url(path)); assert.equal(handled,true); return res; }

test('public issues require login to post, hide email, and allow signed-in discussion', async () => {
  const {system}=fixture();
  let res=await site(system,'POST','/site/api/issues','',{title:'无法创建',body:'匿名用户不应该能够创建这个问题'}); assert.equal(res.status,401);
  res=await site(system,'POST','/site/api/issues','alice-token',{title:'自动验证状态异常',body:'自动验证完成后状态仍显示等待，希望确认原因。'}); assert.equal(res.status,201); const id=res.body.issue.id; assert.deepEqual(res.body.issue.author,{label:'用户 #1'}); assert.equal(JSON.stringify(res.body).includes('alice@example.com'),false);
  res=await site(system,'POST',`/site/api/issues/${id}/replies`,'bob-token',{body:'我也遇到了，可以先导出脱敏日志。'}); assert.equal(res.status,201); assert.equal(res.body.replies.length,1); assert.equal(res.body.replies[0].author.label,'用户 #2');
  res=await site(system,'GET',`/site/api/issues/${id}`); assert.equal(res.status,200); assert.equal(JSON.stringify(res.body).includes('@example.com'),false);
});

test('admin can reply, pin, close, configure and delete while closed issue rejects user reply', async () => {
  const {system}=fixture();
  let res=await site(system,'POST','/site/api/issues','alice-token',{title:'模型锁定问题',body:'锁定模型以后需要确认状态是否保持一致。'}); const id=res.body.issue.id;
  res=await admin(system,'POST',`/admin/api/issues/${id}/replies`,{body:'管理员已收到，会继续核查。'}); assert.equal(res.status,201); assert.equal(res.body.replies[0].authorRole,'admin');
  res=await admin(system,'PATCH',`/admin/api/issues/${id}`,{status:'closed',pinned:true}); assert.equal(res.status,200); assert.equal(res.body.issue.status,'closed'); assert.equal(res.body.issue.pinned,true); assert.equal(res.body.issue.author.email,'alice@example.com');
  res=await site(system,'POST',`/site/api/issues/${id}/replies`,'bob-token',{body:'关闭后不能回复'}); assert.equal(res.status,409);
  res=await admin(system,'PUT','/admin/api/issues/config',{enabled:true,createEnabled:false,replyEnabled:true,pageSize:15,maxTitle:100,maxBody:4000,maxReply:2000}); assert.equal(res.status,200); assert.equal(res.body.config.createEnabled,false); assert.equal(res.body.config.pageSize,15);
  res=await admin(system,'DELETE',`/admin/api/issues/${id}`); assert.equal(res.status,200);
  res=await admin(system,'GET',`/admin/api/issues/${id}`); assert.equal(res.status,404);
});
