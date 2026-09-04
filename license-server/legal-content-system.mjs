const LEGAL_DEFAULTS = {
  privacy: {
    key: 'privacy', name: '隐私政策', path: '/privacy',
    browserTitle: '隐私政策 · Privacy Policy · GPTWork', description: 'GPTWork Privacy Policy / 隐私政策',
    eyebrow: 'Privacy first · Transparent by design', title: '隐私政策', subtitle: 'Privacy Policy', lastUpdated: '2026-09-04',
    content: `> [!NOTE] 核心承诺 / Core commitment
> GPTWork 只处理实现“ChatGPT 网页聊天模型/推理偏好锁定、验证、账户、Issues 讨论与可靠性维护”所必要的数据。我们不出售用户数据，不把聊天或浏览数据用于个性化广告、数据经纪、信用评估或跨站用户画像。
> GPTWork only processes data necessary to provide model/reasoning preference locking and verification on the official ChatGPT web experience, account services, community issues, security, and reliability. We do not sell user data or use chat/browsing data for personalized advertising, data brokerage, credit scoring, or cross-site profiling.

## 1. 适用范围 / Scope
本政策适用于 GPTWork 浏览器扩展、GPTWork Native Core 与 \`gptlock.mv3.cn\` 提供的账户、权益、版本、Issues 讨论、支持和诊断服务。GPTWork 是独立第三方工具，不是 OpenAI 产品，也不代表 OpenAI。

## 2. 我们处理哪些数据 / Data we process
- **账户数据**：邮箱、邮箱验证状态、账户状态。密码通过 HTTPS 发送用于注册/登录/修改密码；服务端保存 scrypt 派生哈希，不保存可直接读取的明文密码。主要位置：GPTWork 服务端。
- **会话与设备**：随机 device ID、browser instance ID、扩展 ID/版本、操作系统/架构、会话创建/最近活动/到期时间，以及用于权益心跳的窗口标识。主要位置：本机 + GPTWork 服务端。
- **网站安全会话**：登录 GPTWork 官网账户中心时，保存会话 token 的哈希、IP 地址和 User-Agent，用于会话展示、登录安全与滥用防护。主要位置：GPTWork 服务端。
- **Issues 讨论内容**：登录用户主动提交的 Issue 标题、正文、回复、状态及时间。公开页面仅显示“用户 #编号”等标签，不公开账户邮箱；管理员后台可看到发帖账户邮箱，用于内容管理和滥用处理。主要位置：GPTWork 服务端；标题、正文与回复属于公开内容。
- **会员与订单**：套餐、权益期限、订单金额、订单状态、支付方式代码、支付跳转 URL。GPTWork 不要求浏览器扩展收集银行卡号、支付密码等支付凭证。主要位置：GPTWork 服务端；实际支付页面由相应支付服务处理。
- **锁定设置**：用户选择的模型、推理偏好、严格模式和相关设置。部分设置使用浏览器 \`storage.sync\`，可能由 Chrome/Edge 对应的浏览器账户同步基础设施处理。主要位置：浏览器本地/同步存储。
- **运行日志**：扩展事件、错误、组件状态和必要的技术元数据。登录用户的运行日志会自动分批上传到 GPTWork 服务端；客户端会对 password、token、cookie、authorization、prompt、request/response body、chat/message/answer content 等敏感键进行脱敏。主要位置：本机 + GPTWork 服务端。
- **自动验证诊断流**：仅在用户启动自动验证时，固定测试探针对应的初始 SSE、handoff 后续 SSE 和匹配 topic 的服务端 WebSocket 接收帧可进入本地诊断缓存，合计上限 10 MiB。原始流可能包含短期 resume token、消息/会话 ID、服务器元数据和固定探针的响应内容。默认仅本机；用户主动导出诊断包时写入用户选择的本地文件。

## 3. 普通 ChatGPT 聊天内容 / Ordinary chat content
GPTWork 的请求锁定功能需要在 \`chatgpt.com\` 上观察与模型/推理偏好直接相关的请求和响应证据，但普通聊天正文不会作为客户端运行日志上传到 GPTWork 服务端。自动验证的原始流采集仅限固定验证流程，不是持续保存所有聊天内容的通用抓包功能。

Ordinary chat bodies are not uploaded as GPTWork client runtime logs. Raw stream capture is limited to the fixed auto-verification workflow and is not a general-purpose archive of all conversations.

## 4. Issues 讨论区 / Community issues
Issues 是公开讨论功能。用户提交前应自行移除邮箱、密码、Cookie、Authorization、会话 token、支付信息、私人聊天和其他不希望公开的信息。公开 API 和页面不会返回发帖账户邮箱，但管理员后台可将帖子关联到对应 GPTWork 账户以处理投诉、滥用和内容管理。管理员可以回复、编辑、置顶、关闭或删除帖子及回复。

## 5. 自动上传的运行日志 / Automatically uploaded runtime logs
用户登录 GPTWork 账户后，扩展会周期性上传尚未确认的脱敏运行日志，用于故障诊断、稳定性分析、安全调查和服务可靠性。服务端默认保留 30 天，部署者可在配置范围内调整。日志与 GPTWork 用户账户、设备/浏览器实例、扩展版本和平台信息关联。普通聊天正文、Cookie、Authorization、密码和会话 token 不应出现在该日志中。

## 6. Native Core / 本地核心
扩展通过浏览器 Native Messaging 与用户主动安装的 GPTWork Native Core 本地通信。Native Core 用于执行本机侧请求锁定/验证相关能力。安装和卸载由用户控制；浏览器商店不会静默替用户安装本地程序。

## 7. 数据共享 / Sharing
我们只在实现上述单一用途所必要的范围内共享数据：Issues 中用户主动发布的内容向访问讨论区的公众展示；邮件服务商用于发送验证码/重置邮件；用户选择的支付服务用于打开支付页面并完成付款；浏览器厂商可能处理使用 \`storage.sync\` 的同步设置；基础设施提供商可能代表 GPTWork 托管服务。除提供功能、维护安全、履行法律义务或经用户明确同意外，我们不会向第三方转让用户数据。

GPTWork does not sell user data and does not transfer user data to advertising platforms or data brokers.

## 8. 数据保留 / Retention
- Issues：主题和回复用于持续的问题跟踪与知识沉淀；管理员可按管理需要删除内容。账户删除时，该账户创建的主题按当前数据结构删除，其用户回复可能保留为不再关联账户的公开讨论内容。
- 客户端运行日志：服务端默认 30 天滚动保留。
- 扩展本地运行日志：最多保留最近 2,000 条；用户可在诊断页面清空。
- 自动验证原始流：本地缓存，合计上限 10 MiB；用户可在诊断页面清空。
- 账户、设备、会话、会员和订单：在账户存在期间用于提供服务；用户执行账户删除后，账户关联数据库记录按删除流程移除。
- 服务器运行日志：采用大小轮转，默认单文件最大 5 MiB 并保留一个轮转文件；记录 HTTP 路径、状态、耗时、Origin/User-Agent 等运行信息，不记录请求正文、Cookie 或 Authorization。

## 9. 用户控制 / Your controls
- 可随时关闭 GPTWork，请求锁定停止生效。
- 可在账户中心释放设备、注销插件会话/网页登录并修改密码。
- 可在诊断页面清空扩展运行日志和自动验证流缓存。
- Issues 内容可通过讨论区提交；如需删除已发布内容，可通过支持渠道联系管理员处理。
- 可在账户中心执行自助账户删除。详细步骤见 [数据删除说明 / Data Deletion](/data-deletion)。

## 10. 安全 / Security
GPTWork 服务端接口使用 HTTPS；密码采用 scrypt 派生哈希保存；会话 token 在服务端以哈希形式索引；网站会话 Cookie 使用 HttpOnly、Secure、SameSite=Strict；运行日志对已知敏感字段进行脱敏。任何系统都不能保证绝对安全，因此我们会持续缩小权限和数据面。

## 11. Chrome Web Store Limited Use
GPTWork 对从浏览器权限、网页和相关 API 获得的信息的使用遵守 Chrome Web Store User Data Policy，包括 Limited Use 要求。相关数据只用于提供或改进 GPTWork 已披露的单一用途、安全和可靠性，不用于个性化广告、数据出售或不相关用途。

## 12. 未成年人 / Children
GPTWork 不以儿童为目标用户，也不会有意为广告或画像目的收集儿童数据。ChatGPT 的使用资格仍受 OpenAI 自身条款约束。

## 13. 政策更新 / Changes
如果数据实践发生实质变化，我们会更新本政策，并在扩展或官网中提供适当提示。商店隐私披露必须与本政策和实际代码保持一致。

## 14. 联系与支持 / Contact
一般技术问题请使用 [GPTWork 支持中心](/support) 或 [Issues 讨论区](/issues)。请不要在公开 Issues 中粘贴邮箱、密码、Cookie、Authorization、会话 token、完整诊断包或私人聊天内容。账户删除请直接使用 [账户中心](/account) 的自助删除功能。`,
  },
  terms: {
    key: 'terms', name: '服务条款', path: '/terms',
    browserTitle: '服务条款 · Terms of Service · GPTWork', description: 'GPTWork Terms of Service / 服务条款',
    eyebrow: 'Terms of Service', title: '服务条款', subtitle: 'Terms of Service', lastUpdated: '2026-09-04',
    content: `> [!NOTE] 重要说明
> GPTWork 是独立第三方工具，不是 OpenAI、Google 或 Microsoft 的官方产品，也不代表这些公司或获得其背书。ChatGPT、Chrome 和 Microsoft Edge 的名称仅用于说明兼容性和使用场景。

## 1. 服务内容
GPTWork 为用户提供浏览器扩展、本地 Native Core、账户/权益、版本发布、诊断、Issues 讨论区与支持服务。核心用途是在 ChatGPT 官方网页聊天中保存并应用用户选择的模型与推理偏好，对相关请求执行锁定，并向用户展示请求/响应证据状态。

## 2. 平台限制
GPTWork 不能赋予用户 ChatGPT 账户本身无权使用的模型、套餐或额度，也不承诺绕过 OpenAI 的区域、账户、速率、内容或其他平台限制。实际可用模型和响应行为由 ChatGPT / OpenAI 决定，平台更新可能影响 GPTWork 的兼容性。

## 3. 账户与安全
- 用户应提供可控制的有效邮箱并妥善保护密码和登录会话。
- 不得共享密码、会话 token 或通过自动化方式滥用 GPTWork 账户系统。
- 发现异常设备或会话时，应及时在账户中心释放设备、注销会话或修改密码。
- GPTWork 可为防止滥用、安全事件或违反本条款的行为限制或停用账户。

## 4. Native Core
部分功能需要用户主动安装 GPTWork Native Core。用户应只从 GPTWork 官方发布渠道获取本地核心。Native Core 的安装、更新和卸载由用户控制；商店版扩展不得静默安装本地程序。

## 5. 付费权益
如果 GPTWork 提供付费会员，购买页面会显示套餐名称、价格、期限和主要权益。GPTWork 是相关数字服务的销售方，Chrome Web Store、Microsoft Edge Add-ons、Google、Microsoft 和 OpenAI 不是 GPTWork 会员服务的销售方。具体支付由页面显示的支付方式完成。

退款、取消或纠纷处理应以购买时展示的销售条款、适用法律和实际履约情况为准。未明确承诺的功能、模型可用性或第三方平台持续兼容性不构成永久保证。

## 6. Issues 讨论区与用户内容
Issues 讨论区用于 GPTWork 相关提问、Bug、兼容性问题、功能建议和用户互助。用户发布的标题、正文和回复会公开展示；公开页面仅使用“用户 #编号”等标签，不公开账户邮箱。用户不得发布密码、Cookie、Token、支付凭据、私人聊天、未经授权的个人信息、违法内容、垃圾广告、恶意代码或侵犯第三方权利的内容。

用户应对自己提交的内容负责。为维护讨论秩序、安全和合法合规，GPTWork 管理员可以回复、编辑标题/正文、置顶、关闭、删除帖子或删除回复；讨论区也可以临时关闭新建或回复功能。

## 7. 可接受使用
不得利用 GPTWork 从事违法活动、未经授权访问第三方账户/系统、恶意抓取、规避第三方访问控制、干扰浏览器/网站安全、传播恶意软件或侵犯他人权利。GPTWork 的调试与网络观察能力只能用于其公开声明的模型偏好锁定和验证用途。

## 8. 隐私
数据处理规则见 [隐私政策 / Privacy Policy](/privacy)。用户可在 [数据删除说明](/data-deletion) 中查看自助删除账户的范围和步骤。

## 9. 软件更新与兼容性
GPTWork 会随浏览器和 ChatGPT 网页变化进行维护。功能、UI、权限或 Native Core 可能因安全、兼容性和商店政策需要调整。商店版扩展本体的更新应通过对应扩展商店分发；本地核心可通过 GPTWork 官方渠道独立更新。

## 10. 服务可用性与责任边界
我们会合理维护服务，但不保证服务永不中断、第三方平台永不变化或任何特定模型始终可用。在适用法律允许的最大范围内，因第三方平台变更、网络故障、浏览器策略、账户限制或用户自行修改软件造成的问题，应按实际责任范围处理。本条款不排除适用法律不能排除的消费者权利。

## 11. 知识产权
GPTWork 自有代码、品牌和原创商店素材归其权利人所有。第三方名称、商标和服务仍归各自权利人所有。未经许可不得冒充 GPTWork 官方版本、使用混淆性品牌或重新分发带有恶意修改的版本。

## 12. 终止与删除
用户可以停止使用、卸载扩展/Native Core，并可在账户中心删除 GPTWork 账户。删除账户会终止相应 GPTWork 权益和会话；按当前数据结构，账户删除也会删除该账户创建的 Issues 主题，用户回复在账户删除后可能仅保留为无账户关联的讨论内容。第三方平台或支付服务保留的数据受其自身政策约束。

## 13. 条款变更
如果条款发生重要变化，我们会更新页面日期并在适当位置提示。继续使用更新后的服务表示用户在适用法律允许的范围内接受新条款。

## 14. 支持
技术问题和公开问题跟踪入口见 [支持中心 / Support](/support) 与 [Issues 讨论区](/issues)。请勿在公开问题中发布账户凭据、会话 token、私人聊天或完整诊断包。`,
  },
  'data-deletion': {
    key: 'data-deletion', name: '数据删除说明', path: '/data-deletion',
    browserTitle: '数据删除 · Data Deletion · GPTWork', description: 'GPTWork Data Deletion / 数据删除说明',
    eyebrow: 'Data Deletion', title: '数据删除', subtitle: 'Account & Data Deletion', lastUpdated: '2026-09-04',
    content: `> [!DANGER] 账户删除不可撤销。
> 删除后 GPTWork 账户、当前权益、设备绑定、插件/网页登录、客户端运行日志、会员记录和订单记录将从 GPTWork 当前账户数据库中删除，无法通过原账户恢复。

## 自助删除步骤
1. 打开 [GPTWork 账户中心](/account) 并登录。
2. 在“删除账户与数据”区域输入当前密码。
3. 输入确认文字 **DELETE**。
4. 点击“永久删除账户与数据”。
5. 服务端验证当前密码后执行事务删除，并立即使当前网页登录 Cookie 失效。

## 删除范围
- 账户邮箱、密码哈希、验证状态和账户状态；
- 设备记录、插件会话、窗口租约和网站会话（包括网站会话中的 IP/User-Agent）；
- 邮箱验证码/密码重置 token 记录；
- 会员权益和 GPTWork 本地订单数据库记录；
- 与该用户关联的客户端运行日志；
- 与该用户关联的账户审计记录。

## 不会由该操作删除的内容
- 你电脑上的 GPTWork 扩展、Native Core 和浏览器本地文件；需要时请另外卸载/清空。
- 你主动导出到电脑的诊断 JSON 文件。
- ChatGPT / OpenAI、Chrome/Google、Microsoft Edge/Microsoft 或支付服务商独立持有的数据；这些数据受对应第三方政策控制。
- GPTWork 服务器的非账户关联运行日志可能在大小轮转周期内短期存在；该日志不保存请求正文、Cookie、Authorization 或密码，并不以邮箱作为 HTTP 请求日志字段。

## 删除前建议
如果你只是更换电脑或浏览器，不需要删除账户。可以在账户中心释放旧设备或注销会话。如果怀疑账号泄露，建议先修改密码，再决定是否删除账户。

## 浏览器本地数据
删除服务端账户后，如需同时清除本机数据，可在浏览器扩展管理页卸载 GPTWork，并删除你主动导出的诊断文件；Native Core 可通过系统卸载方式移除。

## 更多信息
完整数据实践见 [隐私政策 / Privacy Policy](/privacy)。一般技术问题见 [支持中心 / Support](/support)。`,
  },
};

export const DEFAULT_LEGAL_DOCUMENTS = LEGAL_DEFAULTS;

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function text(value, fallback = '', max = 4000) { return String(value ?? fallback).replace(/\r\n?/g, '\n').trim().slice(0, max); }
function httpError(status, message) { return Object.assign(new Error(message), { status }); }
function isoDateOnly(value = new Date()) { const parsed = value instanceof Date ? value : new Date(value); return Number.isNaN(parsed.getTime()) ? new Date().toISOString().slice(0, 10) : parsed.toISOString().slice(0, 10); }

export function normalizeLegalDocument(key, input = {}) {
  const base = LEGAL_DEFAULTS[key];
  if (!base) throw httpError(404, '未知法律文档');
  return {
    key: base.key, name: base.name, path: base.path,
    browserTitle: text(input.browserTitle, base.browserTitle, 180), description: text(input.description, base.description, 600),
    eyebrow: text(input.eyebrow, base.eyebrow, 180), title: text(input.title, base.title, 180), subtitle: text(input.subtitle, base.subtitle, 180),
    lastUpdated: text(input.lastUpdated, base.lastUpdated, 40), content: text(input.content, base.content, 45_000),
  };
}
function sameDocument(left, right) { if (!left || !right) return false; return JSON.stringify(normalizeLegalDocument(left.key, left)) === JSON.stringify(normalizeLegalDocument(right.key, right)); }

export function createLegalContentSystem({ db, json }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS legal_documents (
      key TEXT PRIMARY KEY,
      draft_json TEXT NOT NULL,
      draft_updated_at TEXT NOT NULL,
      published_version INTEGER,
      published_at TEXT
    ) STRICT;
    CREATE TABLE IF NOT EXISTS legal_document_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_key TEXT NOT NULL REFERENCES legal_documents(key) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('seed','publish','rollback')),
      source_version INTEGER,
      payload_json TEXT NOT NULL,
      published_at TEXT NOT NULL,
      UNIQUE(document_key, version)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_legal_versions_document ON legal_document_versions(document_key, version DESC);
  `);
  const audit = db.prepare('INSERT INTO audit_log(event,detail,created_at) VALUES(?,?,?)');
  const legalRow = db.prepare('SELECT key,draft_json,draft_updated_at,published_version,published_at FROM legal_documents WHERE key=?');
  const legalInsert = db.prepare('INSERT INTO legal_documents(key,draft_json,draft_updated_at,published_version,published_at) VALUES(?,?,?,?,?)');
  const legalDraftUpdate = db.prepare('UPDATE legal_documents SET draft_json=?, draft_updated_at=? WHERE key=?');
  const legalPublishUpdate = db.prepare('UPDATE legal_documents SET draft_json=?, draft_updated_at=?, published_version=?, published_at=? WHERE key=?');
  const legalVersionInsert = db.prepare('INSERT INTO legal_document_versions(document_key,version,action,source_version,payload_json,published_at) VALUES(?,?,?,?,?,?)');
  const legalVersion = db.prepare('SELECT version,action,source_version,payload_json,published_at FROM legal_document_versions WHERE document_key=? AND version=?');
  const legalVersions = db.prepare('SELECT version,action,source_version,published_at,length(payload_json) AS payload_bytes FROM legal_document_versions WHERE document_key=? ORDER BY version DESC LIMIT 40');
  const legalMaxVersion = db.prepare('SELECT COALESCE(MAX(version),0) AS version FROM legal_document_versions WHERE document_key=?');

  function seed() {
    const now = new Date().toISOString();
    for (const [key, defaults] of Object.entries(LEGAL_DEFAULTS)) {
      if (legalRow.get(key)) continue;
      const payload = normalizeLegalDocument(key, defaults);
      legalInsert.run(key, JSON.stringify(payload), now, 1, now);
      legalVersionInsert.run(key, 1, 'seed', null, JSON.stringify(payload), now);
    }
  }
  seed();
  function parsePayload(raw, key) { try { return normalizeLegalDocument(key, JSON.parse(raw)); } catch { return clone(LEGAL_DEFAULTS[key]); } }
  function readPublished(key) {
    const row = legalRow.get(key); if (!row) throw httpError(404, '未知法律文档');
    const version = Number(row.published_version || 0); const versionRow = version ? legalVersion.get(key, version) : null;
    return { key, version, publishedAt: row.published_at || null, document: versionRow ? parsePayload(versionRow.payload_json, key) : clone(LEGAL_DEFAULTS[key]) };
  }
  function readAdmin(key) {
    const row = legalRow.get(key); if (!row) throw httpError(404, '未知法律文档'); const published = readPublished(key); const draft = parsePayload(row.draft_json, key);
    return { key, name: LEGAL_DEFAULTS[key].name, path: LEGAL_DEFAULTS[key].path, draft, draftUpdatedAt: row.draft_updated_at, published, dirty: !sameDocument(draft, published.document), history: legalVersions.all(key).map((item) => ({ version: Number(item.version), action: item.action, sourceVersion: item.source_version === null ? null : Number(item.source_version), publishedAt: item.published_at, payloadBytes: Number(item.payload_bytes || 0) })) };
  }
  function readAllAdmin() { return Object.keys(LEGAL_DEFAULTS).map((key) => readAdmin(key)); }
  function saveDraft(key, input) {
    if (!legalRow.get(key)) throw httpError(404, '未知法律文档'); const normalized = normalizeLegalDocument(key, input); const updatedAt = new Date().toISOString();
    legalDraftUpdate.run(JSON.stringify(normalized), updatedAt, key); audit.run('legal_draft_updated', JSON.stringify({ key, chars: normalized.content.length }), updatedAt); return readAdmin(key);
  }
  function publish(key, confirmation) {
    if (String(confirmation || '') !== `PUBLISH:${key}`) throw httpError(400, '发布确认无效');
    const current = legalRow.get(key); if (!current) throw httpError(404, '未知法律文档'); const published = readPublished(key); const draft = parsePayload(current.draft_json, key);
    if (draft.title.length < 2 || draft.content.length < 100) throw httpError(400, '法律文档标题或正文过短，不能发布');
    if (sameDocument(draft, published.document)) throw httpError(409, '草稿与当前已发布版本没有变化');
    const now = new Date().toISOString(); const payload = normalizeLegalDocument(key, { ...draft, lastUpdated: isoDateOnly(now) }); const version = Number(legalMaxVersion.get(key).version || 0) + 1;
    db.exec('BEGIN IMMEDIATE');
    try { legalVersionInsert.run(key, version, 'publish', null, JSON.stringify(payload), now); legalPublishUpdate.run(JSON.stringify(payload), now, version, now, key); audit.run('legal_document_published', JSON.stringify({ key, version, chars: payload.content.length }), now); db.exec('COMMIT'); }
    catch (error) { db.exec('ROLLBACK'); throw error; }
    return readAdmin(key);
  }
  function rollback(key, sourceVersion, confirmation) {
    if (String(confirmation || '') !== `ROLLBACK:${key}`) throw httpError(400, '回滚确认无效');
    const source = legalVersion.get(key, Number(sourceVersion)); if (!source) throw httpError(404, '目标历史版本不存在');
    const now = new Date().toISOString(); const sourcePayload = parsePayload(source.payload_json, key); const payload = normalizeLegalDocument(key, { ...sourcePayload, lastUpdated: isoDateOnly(now) }); const version = Number(legalMaxVersion.get(key).version || 0) + 1;
    db.exec('BEGIN IMMEDIATE');
    try { legalVersionInsert.run(key, version, 'rollback', Number(sourceVersion), JSON.stringify(payload), now); legalPublishUpdate.run(JSON.stringify(payload), now, version, now, key); audit.run('legal_document_rolled_back', JSON.stringify({ key, version, sourceVersion: Number(sourceVersion) }), now); db.exec('COMMIT'); }
    catch (error) { db.exec('ROLLBACK'); throw error; }
    return readAdmin(key);
  }
  function restoreDraft(key) { const published = readPublished(key); const updatedAt = new Date().toISOString(); legalDraftUpdate.run(JSON.stringify(published.document), updatedAt, key); audit.run('legal_draft_restored', JSON.stringify({ key, version: published.version }), updatedAt); return readAdmin(key); }
  function readVersion(key, version) { const row = legalVersion.get(key, Number(version)); if (!row) throw httpError(404, '历史版本不存在'); return { key, version: Number(row.version), action: row.action, sourceVersion: row.source_version === null ? null : Number(row.source_version), publishedAt: row.published_at, document: parsePayload(row.payload_json, key) }; }

  async function handleSite(req, res, url) {
    const match = url.pathname.match(/^\/site\/api\/legal\/(privacy|terms|data-deletion)$/); if (!match || req.method !== 'GET') return false;
    json(res, 200, { ok: true, ...readPublished(match[1]) }); return true;
  }
  async function handleAdmin(req, res, url, bodyJson) {
    if (url.pathname === '/admin/api/legal' && req.method === 'GET') { json(res, 200, { ok: true, documents: readAllAdmin() }); return true; }
    const match = url.pathname.match(/^\/admin\/api\/legal\/(privacy|terms|data-deletion)(?:\/(draft|publish|rollback|restore|version))?$/); if (!match) return false;
    const [, key, action = ''] = match;
    if (!action && req.method === 'GET') { json(res, 200, { ok: true, ...readAdmin(key) }); return true; }
    if (action === 'draft' && req.method === 'PUT') { const input = await bodyJson(req); json(res, 200, { ok: true, ...saveDraft(key, input.document || input) }); return true; }
    if (action === 'publish' && req.method === 'POST') { const input = await bodyJson(req); json(res, 200, { ok: true, ...publish(key, input.confirmation) }); return true; }
    if (action === 'rollback' && req.method === 'POST') { const input = await bodyJson(req); json(res, 200, { ok: true, ...rollback(key, input.version, input.confirmation) }); return true; }
    if (action === 'restore' && req.method === 'POST') { json(res, 200, { ok: true, ...restoreDraft(key) }); return true; }
    if (action === 'version' && req.method === 'GET') { json(res, 200, { ok: true, ...readVersion(key, url.searchParams.get('version')) }); return true; }
    throw httpError(405, '不支持的法律文档操作');
  }
  return { readPublished, readAdmin, readAllAdmin, saveDraft, publish, rollback, restoreDraft, readVersion, handleSite, handleAdmin };
}
