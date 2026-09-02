import { spawn } from 'node:child_process';

const DEFAULT_MAX_BYTES = 256 * 1024 * 1024;
const SAFE_PROXY_PROTOCOLS = new Set(['http:', 'https:', 'socks5:', 'socks5h:']);

function configQuote(value) {
  return String(value ?? '')
    .replace(/[\r\n]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
}

export function normalizeReleaseProxy(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (!SAFE_PROXY_PROTOCOLS.has(parsed.protocol)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function createCurlReleaseTransport({
  env = process.env,
  spawnImpl = spawn,
} = {}) {
  const curlBin = String(env.GPTLOCK_RELEASE_CURL_BIN || 'curl').trim() || 'curl';
  const proxyRaw = String(env.GPTLOCK_RELEASE_PROXY || '').trim();
  const proxy = normalizeReleaseProxy(proxyRaw);
  const invalidProxy = Boolean(proxyRaw && !proxy);
  const maxBytes = Math.max(1024 * 1024, Number(env.GPTLOCK_RELEASE_MAX_RESPONSE_BYTES || DEFAULT_MAX_BYTES));

  async function request(url, {
    headers = {},
    timeoutMs = 20_000,
  } = {}) {
    if (invalidProxy) throw new Error('GPTLOCK_RELEASE_PROXY has an unsupported or invalid proxy URL');
    const target = new URL(String(url));
    if (target.protocol !== 'https:') throw new Error('Release transport only permits HTTPS URLs');

    const connectSeconds = Math.max(1, Math.ceil(Math.min(timeoutMs, 20_000) / 1000));
    const maxSeconds = Math.max(1, Math.ceil(timeoutMs / 1000));
    const lines = [
      'silent',
      'show-error',
      'fail-with-body',
      'location',
      `connect-timeout = "${connectSeconds}"`,
      `max-time = "${maxSeconds}"`,
      `url = "${configQuote(target.toString())}"`,
    ];
    for (const [name, value] of Object.entries(headers || {})) {
      lines.push(`header = "${configQuote(`${name}: ${value}`)}"`);
    }
    if (proxy) lines.push(`proxy = "${configQuote(proxy)}"`);
    const config = `${lines.join('\n')}\n`;

    return await new Promise((resolve, reject) => {
      const child = spawnImpl(curlBin, ['--config', '-'], {
        env: {
          PATH: env.PATH || process.env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
          HOME: env.HOME || process.env.HOME || '/',
          LANG: env.LANG || process.env.LANG || 'C.UTF-8',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const stdout = [];
      const stderr = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let settled = false;

      const finish = (error, response = null) => {
        if (settled) return;
        settled = true;
        if (error) reject(error);
        else resolve(response);
      };

      child.stdout.on('data', (chunk) => {
        stdoutBytes += chunk.length;
        if (stdoutBytes > maxBytes) {
          child.kill('SIGKILL');
          finish(new Error(`Release cURL response exceeds ${maxBytes} bytes`));
          return;
        }
        stdout.push(chunk);
      });
      child.stderr.on('data', (chunk) => {
        if (stderrBytes >= 16 * 1024) return;
        stderrBytes += chunk.length;
        stderr.push(chunk);
      });
      child.on('error', (error) => finish(new Error(`Release cURL failed to start: ${error.message}`)));
      child.on('close', (code, signal) => {
        if (settled) return;
        const body = Buffer.concat(stdout);
        if (code !== 0) {
          const detail = Buffer.concat(stderr).toString('utf8').trim().slice(0, 1000);
          const suffix = signal ? ` signal=${signal}` : '';
          finish(new Error(`Release cURL failed (exit=${code}${suffix})${detail ? `: ${detail}` : ''}`));
          return;
        }
        finish(null, new Response(body, { status: 200 }));
      });
      child.stdin.end(config);
    });
  }

  return {
    request,
    proxyConfigured: Boolean(proxy),
    proxyInvalid: invalidProxy,
    curlBin,
  };
}
