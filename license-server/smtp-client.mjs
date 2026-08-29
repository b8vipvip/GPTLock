import net from 'node:net';
import tls from 'node:tls';

class SmtpProtocolError extends Error {
  constructor(message, response = null) {
    super(message);
    this.name = 'SmtpProtocolError';
    this.response = response;
  }
}

class SmtpConnection {
  constructor(socket, { timeoutMs = 12000 } = {}) {
    this.socket = null;
    this.timeoutMs = timeoutMs;
    this.buffer = '';
    this.responses = [];
    this.waiters = [];
    this.closedError = null;
    this.attach(socket);
  }

  attach(socket) {
    if (this.socket) {
      this.socket.removeAllListeners('data');
      this.socket.removeAllListeners('error');
      this.socket.removeAllListeners('close');
      this.socket.removeAllListeners('timeout');
    }
    this.socket = socket;
    this.buffer = '';
    this.responses = [];
    this.closedError = null;
    socket.setTimeout(this.timeoutMs);
    socket.on('data', (chunk) => this.onData(chunk));
    socket.on('error', (error) => this.fail(error));
    socket.on('timeout', () => this.fail(new Error('SMTP connection timed out')));
    socket.on('close', () => this.fail(new Error('SMTP connection closed')));
  }

  onData(chunk) {
    this.buffer += chunk.toString('utf8');
    while (true) {
      const match = this.buffer.match(/^(?:\d{3}[- ].*\r?\n)+/);
      if (!match) return;
      const block = match[0];
      const lines = block.trimEnd().split(/\r?\n/);
      const firstCode = lines[0]?.slice(0, 3);
      const complete = lines.some((line) => line.startsWith(`${firstCode} `));
      if (!complete) return;
      this.buffer = this.buffer.slice(block.length);
      const response = { code: Number(firstCode), lines, text: lines.map((line) => line.slice(4)).join('\n') };
      const waiter = this.waiters.shift();
      if (waiter) waiter.resolve(response);
      else this.responses.push(response);
    }
  }

  fail(error) {
    if (this.closedError) return;
    this.closedError = error instanceof Error ? error : new Error(String(error));
    for (const waiter of this.waiters.splice(0)) waiter.reject(this.closedError);
  }

  nextResponse() {
    if (this.responses.length) return Promise.resolve(this.responses.shift());
    if (this.closedError) return Promise.reject(this.closedError);
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  async expect(codes) {
    const expected = Array.isArray(codes) ? codes : [codes];
    const response = await this.nextResponse();
    if (!expected.includes(response.code)) {
      throw new SmtpProtocolError(`Unexpected SMTP response ${response.code}`, response);
    }
    return response;
  }

  async command(line, codes) {
    this.socket.write(`${line}\r\n`);
    return this.expect(codes);
  }

  async upgradeToTls(host) {
    const plain = this.socket;
    plain.removeAllListeners('data');
    plain.removeAllListeners('error');
    plain.removeAllListeners('close');
    plain.removeAllListeners('timeout');
    const secure = tls.connect({ socket: plain, servername: host, rejectUnauthorized: true });
    await new Promise((resolve, reject) => {
      secure.once('secureConnect', resolve);
      secure.once('error', reject);
    });
    this.attach(secure);
  }

  destroy() {
    try { this.socket?.destroy(); } catch {}
  }
}

function encodeHeader(value) {
  return `=?UTF-8?B?${Buffer.from(String(value || ''), 'utf8').toString('base64')}?=`;
}

function sanitizeHeader(value) {
  return String(value || '').replace(/[\r\n]+/g, ' ').trim();
}

function dotStuff(value) {
  return String(value || '').replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
}

function connectSocket({ host, port, secure, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const options = { host, port, timeout: timeoutMs };
    const socket = secure
      ? tls.connect({ ...options, servername: host, rejectUnauthorized: true })
      : net.createConnection(options);
    const ready = secure ? 'secureConnect' : 'connect';
    socket.once(ready, () => resolve(socket));
    socket.once('error', reject);
  });
}

export async function sendSmtpMail(config, message) {
  const host = String(config?.host || '').trim();
  const port = Number(config?.port || (config?.secure ? 465 : 587));
  const secure = Boolean(config?.secure);
  const username = String(config?.username || '').trim();
  const password = String(config?.password || '');
  const fromEmail = String(config?.fromEmail || username).trim();
  const fromName = sanitizeHeader(config?.fromName || 'GPTLock');
  const to = String(message?.to || '').trim();
  const subject = sanitizeHeader(message?.subject || 'GPTLock');
  const text = String(message?.text || '');
  const timeoutMs = Math.max(3000, Number(config?.timeoutMs || 12000));

  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SMTP host/port is invalid');
  if (!fromEmail || !to || /[\r\n<>]/.test(fromEmail) || /[\r\n<>]/.test(to)) throw new Error('SMTP sender/recipient is invalid');
  if (username && !password) throw new Error('SMTP password is missing');

  const socket = await connectSocket({ host, port, secure, timeoutMs });
  const smtp = new SmtpConnection(socket, { timeoutMs });
  try {
    await smtp.expect(220);
    let hello = await smtp.command(`EHLO ${sanitizeHeader(config?.clientName || 'gptlock.local')}`, 250);
    if (!secure) {
      const supportsStartTls = hello.lines.some((line) => /STARTTLS/i.test(line));
      if (!supportsStartTls) throw new Error('SMTP server does not offer STARTTLS; refusing insecure mail transport');
      await smtp.command('STARTTLS', 220);
      await smtp.upgradeToTls(host);
      hello = await smtp.command(`EHLO ${sanitizeHeader(config?.clientName || 'gptlock.local')}`, 250);
    }

    if (username) {
      await smtp.command('AUTH LOGIN', 334);
      await smtp.command(Buffer.from(username, 'utf8').toString('base64'), 334);
      await smtp.command(Buffer.from(password, 'utf8').toString('base64'), 235);
    }

    await smtp.command(`MAIL FROM:<${fromEmail}>`, 250);
    await smtp.command(`RCPT TO:<${to}>`, [250, 251]);
    await smtp.command('DATA', 354);
    const headers = [
      `From: ${encodeHeader(fromName)} <${fromEmail}>`,
      `To: <${to}>`,
      `Subject: ${encodeHeader(subject)}`,
      `Date: ${new Date().toUTCString()}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: 8bit',
      'X-Mailer: GPTLock',
    ].join('\r\n');
    smtp.socket.write(`${headers}\r\n\r\n${dotStuff(text)}\r\n.\r\n`);
    await smtp.expect(250);
    try { await smtp.command('QUIT', 221); } catch {}
    return { ok: true };
  } finally {
    smtp.destroy();
  }
}
