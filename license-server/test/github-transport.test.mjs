import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const helper = new URL('../scripts/github-fetch.sh', import.meta.url);
const knownHosts = new URL('../scripts/github-known-hosts', import.meta.url);
const updater = new URL('../scripts/update-server.sh', import.meta.url);
const installer = new URL('../scripts/install-updater-systemd.sh', import.meta.url);

function run(args, env = {}) {
  return spawnSync('bash', [helper.pathname, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

function runGit(args) {
  return spawnSync('git', args, { encoding: 'utf8' });
}

test('auto transport prefers SSH and keeps HTTPS fallback', () => {
  const result = run(['--plan', 'https://github.com/b8vipvip/GPTLock.git', 'auto']);
  assert.equal(result.status, 0, result.stderr);
  const lines = result.stdout.trim().split(/\r?\n/);
  assert.deepEqual(lines.slice(0, 2), [
    'ssh-22|ssh|git@github.com:b8vipvip/GPTLock.git',
    'ssh-443|ssh|ssh://git@ssh.github.com:443/b8vipvip/GPTLock.git',
  ]);
  assert.ok(lines.some((line) => line.includes('|https|https://github.com/b8vipvip/GPTLock.git')));
});

test('SSH origin is attempted before canonical SSH fallbacks', () => {
  const result = run(['--plan', 'git@github.com:b8vipvip/GPTLock.git', 'auto']);
  assert.equal(result.status, 0, result.stderr);
  const lines = result.stdout.trim().split(/\r?\n/);
  assert.equal(lines[0], 'origin-ssh|ssh|git@github.com:b8vipvip/GPTLock.git');
  assert.ok(lines.some((line) => line.startsWith('ssh-443|ssh|')));
  assert.ok(lines.some((line) => line.includes('|https|')));
});

test('ssh mode never falls back to HTTPS', () => {
  const result = run(['--plan', 'https://github.com/b8vipvip/GPTLock.git', 'ssh']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ssh-22\|ssh\|/);
  assert.match(result.stdout, /ssh-443\|ssh\|/);
  assert.doesNotMatch(result.stdout, /\|https\|/);
});

test('untrusted origins are rejected before network access', () => {
  const validate = run(['--validate-url', 'git@github.com:attacker/GPTWork.git']);
  assert.notEqual(validate.status, 0);

  const plan = run(['--plan', 'https://example.com/b8vipvip/GPTLock.git', 'auto']);
  assert.notEqual(plan.status, 0);
  assert.match(plan.stderr, /untrusted Git origin/i);
});

test('successful fetch is recognized when helper runs outside repository cwd', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gptlock-fetch-test-'));
  const repo = join(dir, 'repo');
  const bin = join(dir, 'bin');
  try {
    await mkdir(repo);
    await mkdir(bin);
    assert.equal(runGit(['init', repo]).status, 0);
    assert.equal(runGit(['-C', repo, 'config', 'user.email', 'test@example.invalid']).status, 0);
    assert.equal(runGit(['-C', repo, 'config', 'user.name', 'GPTWork Test']).status, 0);
    await writeFile(join(repo, 'README.md'), 'fetch test\n');
    assert.equal(runGit(['-C', repo, 'add', 'README.md']).status, 0);
    assert.equal(runGit(['-C', repo, 'commit', '-m', 'fixture']).status, 0);
    assert.equal(runGit(['-C', repo, 'remote', 'add', 'origin', 'https://github.com/b8vipvip/GPTLock.git']).status, 0);

    const realGit = spawnSync('bash', ['-lc', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
    assert.ok(realGit);
    const fakeGit = join(bin, 'git');
    await writeFile(fakeGit, `#!/usr/bin/env bash
set -Eeuo pipefail
REAL_GIT=${JSON.stringify(realGit)}
repo_dir=""
previous=""
for arg in "$@"; do
  if [[ "$previous" == "-C" ]]; then repo_dir="$arg"; fi
  previous="$arg"
done
for arg in "$@"; do
  if [[ "$arg" == "fetch" ]]; then
    [[ -n "$repo_dir" ]]
    git_dir="$($REAL_GIT -C "$repo_dir" rev-parse --absolute-git-dir)"
    commit="$($REAL_GIT -C "$repo_dir" rev-parse HEAD)"
    printf '%s\t\tbranch '\''main'\'' of https://github.com/b8vipvip/GPTLock\n' "$commit" >"$git_dir/FETCH_HEAD"
    exit 0
  fi
done
exec "$REAL_GIT" "$@"
`);
    await chmod(fakeGit, 0o755);

    const result = spawnSync('bash', [helper.pathname, repo, 'main'], {
      cwd: dir,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        GPTLOCK_UPDATE_TRANSPORT: 'https',
        GPTLOCK_UPDATE_FETCH_RETRIES: '1',
      },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), 'origin-https');
    assert.match(result.stderr, /GitHub fetch succeeded route=origin-https/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('HTTPS private-repo authentication uses an environment-backed credential helper without logging the token', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gptlock-private-fetch-test-'));
  const repo = join(dir, 'repo');
  const bin = join(dir, 'bin');
  const token = 'github_pat_DO_NOT_LEAK_private_repo_test_123456789';
  try {
    await mkdir(repo);
    await mkdir(bin);
    assert.equal(runGit(['init', repo]).status, 0);
    assert.equal(runGit(['-C', repo, 'config', 'user.email', 'test@example.invalid']).status, 0);
    assert.equal(runGit(['-C', repo, 'config', 'user.name', 'GPTWork Test']).status, 0);
    await writeFile(join(repo, 'README.md'), 'private fetch test\n');
    assert.equal(runGit(['-C', repo, 'add', 'README.md']).status, 0);
    assert.equal(runGit(['-C', repo, 'commit', '-m', 'fixture']).status, 0);
    assert.equal(runGit(['-C', repo, 'remote', 'add', 'origin', 'https://github.com/b8vipvip/GPTLock.git']).status, 0);

    const realGit = spawnSync('bash', ['-lc', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
    assert.ok(realGit);
    const fakeGit = join(bin, 'git');
    await writeFile(fakeGit, `#!/usr/bin/env bash
set -Eeuo pipefail
REAL_GIT=${JSON.stringify(realGit)}
repo_dir=""
previous=""
for arg in "$@"; do
  if [[ "$previous" == "-C" ]]; then repo_dir="$arg"; fi
  previous="$arg"
done
for arg in "$@"; do
  if [[ "$arg" == "fetch" ]]; then
    [[ -n "$repo_dir" ]]
    [[ "\${GPTLOCK_GITHUB_TOKEN:-}" == ${JSON.stringify(token)} ]]
    printf '%s\n' "$@" >"$repo_dir/fetch-args.txt"
    git_dir="$($REAL_GIT -C "$repo_dir" rev-parse --absolute-git-dir)"
    commit="$($REAL_GIT -C "$repo_dir" rev-parse HEAD)"
    printf '%s\t\tbranch '\''main'\'' of https://github.com/b8vipvip/GPTLock\n' "$commit" >"$git_dir/FETCH_HEAD"
    exit 0
  fi
done
exec "$REAL_GIT" "$@"
`);
    await chmod(fakeGit, 0o755);

    const result = spawnSync('bash', [helper.pathname, repo, 'main'], {
      cwd: dir,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        GPTLOCK_UPDATE_TRANSPORT: 'https',
        GPTLOCK_UPDATE_FETCH_RETRIES: '1',
        GPTLOCK_GITHUB_TOKEN: token,
      },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), 'origin-https');
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, new RegExp(token));

    const args = await readFile(join(repo, 'fetch-args.txt'), 'utf8');
    assert.match(args, /credential\.helper=/);
    assert.match(args, /username=x-access-token/);
    assert.match(args, /password=\$GPTLOCK_GITHUB_TOKEN/);
    assert.doesNotMatch(args, new RegExp(token));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('GitHub host keys are pinned for SSH 22 and SSH 443', async () => {
  const content = await readFile(knownHosts, 'utf8');
  const key = 'AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl';
  assert.match(content, new RegExp(`^github\\.com ssh-ed25519 ${key}$`, 'm'));
  assert.match(content, new RegExp(`^\\[ssh\\.github\\.com\\]:443 ssh-ed25519 ${key}$`, 'm'));
});

test('invalid transport configuration fails closed', () => {
  const result = run(['--plan', 'https://github.com/b8vipvip/GPTLock.git'], {
    GPTLOCK_UPDATE_TRANSPORT: 'anything-goes',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must be auto, ssh, https, or origin/);
});

test('updater keeps deployed checkout readable while updater artifacts stay private', async () => {
  const content = await readFile(updater, 'utf8');
  assert.match(content, /^umask 022$/m);
  assert.match(content, /chmod 600 "\$LOG_FILE"/);
  assert.match(content, /chmod 600 "\$LOCK_FILE"/);
  assert.match(content, /\{mode:0o600\}/);
});

test('installer does not make tracked updater scripts executable', async () => {
  const content = await readFile(installer, 'utf8');
  assert.match(content, /chmod 640 "\$UPDATE_SCRIPT" "\$FETCH_HELPER"/);
  assert.doesNotMatch(content, /chmod 750 "\$UPDATE_SCRIPT" "\$FETCH_HELPER"/);
});
