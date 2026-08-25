import { normalizeModelId, normalizeReasoningLevel } from './policy.js';

const MODEL_KEYS = new Set([
  'model_slug',
  'modelslug',
  'model_id',
  'modelid',
  'used_model',
  'resolved_model',
  'served_model',
  'model',
]);
const REASONING_KEYS = new Set([
  'reasoning_effort',
  'reasoningeffort',
  'reasoning_level',
  'reasoninglevel',
  'thinking_level',
  'thinkinglevel',
]);
const SKIPPED_CONTENT_KEYS = new Set([
  'content',
  'parts',
  'text',
  'prompt',
  'input',
  'output_text',
  'arguments',
]);
const MODEL_HEADERS = [
  'x-openai-model',
  'openai-model',
  'x-gpt-model',
  'x-model',
];
const REASONING_HEADERS = [
  'x-openai-reasoning-effort',
  'x-reasoning-effort',
  'x-reasoning-level',
];
const MAX_WALK_DEPTH = 14;
const MAX_BODY_CHARS = 16 * 1024 * 1024;

function canonicalKey(value) {
  return String(value).trim().toLowerCase().replace(/[-.]/g, '_');
}

function modelFrom(value) {
  if (typeof value !== 'string') return null;
  return normalizeModelId(value);
}

function reasoningFrom(value) {
  if (typeof value !== 'string') return null;
  return normalizeReasoningLevel(value);
}

function pathScore(path, key, kind) {
  const normalizedPath = path.map(canonicalKey);
  const metadata = normalizedPath.some((part) => /metadata|details|response/.test(part));
  if (kind === 'model') {
    if (/served|resolved|used/.test(key)) return 130;
    if (key.includes('slug') && metadata) return 120;
    if (key.includes('slug')) return 105;
    if (metadata) return 100;
    return path.length <= 2 ? 90 : 35;
  }
  return metadata ? 115 : path.length <= 3 ? 95 : 70;
}

function collectCandidates(value, candidates, path = [], depth = 0) {
  if (depth > MAX_WALK_DEPTH || value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      collectCandidates(value[index], candidates, [...path, String(index)], depth + 1);
    }
    return;
  }

  for (const [rawKey, child] of Object.entries(value)) {
    const key = canonicalKey(rawKey);
    const nextPath = [...path, rawKey];
    if (MODEL_KEYS.has(key)) {
      const model = modelFrom(child);
      if (model) candidates.model.push({ value: model, score: pathScore(path, key, 'model'), path: nextPath.join('.') });
    }
    if (REASONING_KEYS.has(key)) {
      const reasoning = reasoningFrom(child);
      if (reasoning) candidates.reasoning.push({ value: reasoning, score: pathScore(path, key, 'reasoning'), path: nextPath.join('.') });
    }
    if (!SKIPPED_CONTENT_KEYS.has(key)) {
      collectCandidates(child, candidates, nextPath, depth + 1);
    }
  }
}

function selectCandidate(candidates) {
  if (!candidates.length) return { value: null, conflict: false, path: null };
  const bestScore = Math.max(...candidates.map((candidate) => candidate.score));
  const best = candidates.filter((candidate) => candidate.score === bestScore);
  const values = [...new Set(best.map((candidate) => candidate.value))];
  if (values.length !== 1) return { value: null, conflict: true, path: null };
  return { value: values[0], conflict: false, path: best[best.length - 1].path };
}

function inspectObjects(values) {
  const candidates = { model: [], reasoning: [] };
  for (const value of values) collectCandidates(value, candidates);
  const model = selectCandidate(candidates.model);
  const reasoning = selectCandidate(candidates.reasoning);
  return {
    model: model.value,
    reasoning: reasoning.value,
    conflicts: {
      model: model.conflict,
      reasoning: reasoning.conflict,
    },
    fields: {
      model: model.path,
      reasoning: reasoning.path,
    },
  };
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function parseSseObjects(body) {
  const objects = [];
  let dataLines = [];
  const flush = () => {
    if (!dataLines.length) return;
    const data = dataLines.join('\n').trim();
    dataLines = [];
    if (!data || data === '[DONE]') return;
    const parsed = parseJson(data);
    if (parsed && typeof parsed === 'object') objects.push(parsed);
  };

  for (const line of String(body).split(/\r?\n/)) {
    if (line === '') {
      flush();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }
  flush();
  return objects;
}

function bodyObjects(body, mimeType = '') {
  if (typeof body !== 'string' || !body || body.length > MAX_BODY_CHARS) return [];
  const trimmed = body.trim();
  const values = [];
  const whole = parseJson(trimmed);
  if (whole && typeof whole === 'object') values.push(whole);
  if (/event-stream/i.test(mimeType) || /(^|\n)data:/.test(trimmed)) {
    values.push(...parseSseObjects(trimmed));
  }
  if (!values.length && trimmed.includes('\n')) {
    for (const line of trimmed.split(/\r?\n/)) {
      const parsed = parseJson(line.trim());
      if (parsed && typeof parsed === 'object') values.push(parsed);
    }
  }
  return values;
}

function normalizeHeaders(headers) {
  const normalized = new Map();
  if (Array.isArray(headers)) {
    for (const header of headers) {
      if (header?.name && typeof header.value === 'string') {
        normalized.set(header.name.toLowerCase(), header.value);
      }
    }
  } else if (headers && typeof headers === 'object') {
    for (const [name, value] of Object.entries(headers)) {
      if (typeof value === 'string') normalized.set(name.toLowerCase(), value);
    }
  }
  return normalized;
}

export function extractHeaderEvidence(headers) {
  const normalized = normalizeHeaders(headers);
  let model = null;
  let modelHeader = null;
  let reasoning = null;
  let reasoningHeader = null;
  for (const name of MODEL_HEADERS) {
    const value = modelFrom(normalized.get(name));
    if (value) {
      model = value;
      modelHeader = name;
      break;
    }
  }
  for (const name of REASONING_HEADERS) {
    const value = reasoningFrom(normalized.get(name));
    if (value) {
      reasoning = value;
      reasoningHeader = name;
      break;
    }
  }
  return {
    model,
    reasoning,
    conflicts: { model: false, reasoning: false },
    fields: { model: modelHeader, reasoning: reasoningHeader },
  };
}

function mergeEvidence(headerEvidence, bodyEvidence) {
  const modelConflict = Boolean(
    headerEvidence.model && bodyEvidence.model && headerEvidence.model !== bodyEvidence.model,
  ) || headerEvidence.conflicts.model || bodyEvidence.conflicts.model;
  const reasoningConflict = Boolean(
    headerEvidence.reasoning && bodyEvidence.reasoning && headerEvidence.reasoning !== bodyEvidence.reasoning,
  ) || headerEvidence.conflicts.reasoning || bodyEvidence.conflicts.reasoning;
  return {
    model: modelConflict ? null : headerEvidence.model || bodyEvidence.model,
    reasoning: reasoningConflict ? null : headerEvidence.reasoning || bodyEvidence.reasoning,
    conflicts: { model: modelConflict, reasoning: reasoningConflict },
    fields: {
      model: headerEvidence.fields.model || bodyEvidence.fields.model,
      reasoning: headerEvidence.fields.reasoning || bodyEvidence.fields.reasoning,
    },
  };
}

export function extractResponseEvidence({ body = '', headers = {}, mimeType = '' } = {}) {
  const headerEvidence = extractHeaderEvidence(headers);
  const bodyEvidence = inspectObjects(bodyObjects(body, mimeType));
  return {
    ...mergeEvidence(headerEvidence, bodyEvidence),
    evidenceSource: 'network_response_metadata',
  };
}

export function extractRequestEvidence(postData = '') {
  const parsed = typeof postData === 'string' ? parseJson(postData) : null;
  const evidence = inspectObjects(parsed && typeof parsed === 'object' ? [parsed] : []);
  return { ...evidence, evidenceSource: 'network_request_metadata' };
}

export function isChatGptConversationRequest(url, method = 'GET') {
  if (String(method).toUpperCase() !== 'POST') return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'chatgpt.com') return false;
    if (!parsed.pathname.startsWith('/backend-api/')) return false;
    return /(?:conversation|responses?|messages?|codex)/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

export function decodeCdpBody(body, base64Encoded) {
  if (!base64Encoded) return typeof body === 'string' ? body : '';
  try {
    const binary = atob(String(body));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return '';
  }
}
