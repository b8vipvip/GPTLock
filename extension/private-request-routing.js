const MAX_PATCHES = 32;
const MAX_PATH_SEGMENT_LENGTH = 256;
const MAX_METADATA_STRING_LENGTH = 256;

function boundedString(value, fallback = '') {
  const text = typeof value === 'string' ? value : fallback;
  if (text.length > MAX_METADATA_STRING_LENGTH) throw new TypeError('private request metadata string is too long');
  return text;
}

function optionalString(value) {
  if (value === null || value === undefined || value === '') return null;
  return boundedString(value);
}

function stringList(value, limit = 32) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => typeof entry === 'string' && entry.length > 0 && entry.length <= MAX_METADATA_STRING_LENGTH)
    .slice(0, limit);
}

export function buildPrivateRequestPayload(request, postData, configuration = {}) {
  let url;
  try {
    url = new URL(String(request?.url || ''));
  } catch {
    url = null;
  }
  return {
    host: url?.hostname || '',
    path: url?.pathname || '',
    method: String(request?.method || ''),
    postData: typeof postData === 'string' ? postData : '',
    lockedModels: stringList(configuration.lockedModels),
    allowedReasoningLevels: stringList(configuration.allowedReasoningLevels),
    preferredReasoning: optionalString(configuration.preferredReasoning),
  };
}

function normalizePatch(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('private request patch must be an object');
  }
  const op = String(value.op || '');
  if (!['add', 'replace', 'remove'].includes(op)) throw new TypeError('unsupported private request patch operation');
  if (!Array.isArray(value.path) || value.path.length !== 1) {
    throw new TypeError('private request patch must target one top-level property');
  }
  const key = String(value.path[0] ?? '');
  if (!key || key.length > MAX_PATH_SEGMENT_LENGTH) throw new TypeError('invalid private request patch path');
  const patch = { op, path: [key] };
  if (op !== 'remove') {
    if (!Object.hasOwn(value, 'value')) throw new TypeError('private request patch value is missing');
    patch.value = value.value;
  }
  return patch;
}

export function normalizePrivateRequestDecision(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('private request decision must be an object');
  }
  const patches = Array.isArray(value.patches) ? value.patches.map(normalizePatch) : [];
  if (patches.length > MAX_PATCHES) throw new TypeError('too many private request patches');
  const changed = Boolean(value.changed);
  if (changed && patches.length === 0) throw new TypeError('changed private request decision has no patches');
  if (!changed && patches.length !== 0) throw new TypeError('unchanged private request decision contains patches');
  return {
    officialConversation: Boolean(value.officialConversation),
    changed,
    reason: boundedString(value.reason, changed ? 'rewritten' : 'unchanged'),
    patches,
    modelBefore: optionalString(value.modelBefore),
    modelAfter: optionalString(value.modelAfter),
    transportModelBefore: optionalString(value.transportModelBefore),
    transportModelAfter: optionalString(value.transportModelAfter),
    reasoningBefore: optionalString(value.reasoningBefore),
    reasoningAfter: optionalString(value.reasoningAfter),
    reasoningFields: stringList(value.reasoningFields),
  };
}

export function applyPrivateRequestPatches(postData, patches) {
  if (!Array.isArray(patches) || patches.length === 0) return String(postData ?? '');
  let value;
  try {
    value = JSON.parse(String(postData ?? ''));
  } catch {
    throw new TypeError('cannot apply private request patches to non-JSON request body');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('private request patches require a JSON object request body');
  }
  for (const rawPatch of patches) {
    const patch = normalizePatch(rawPatch);
    const key = patch.path[0];
    if (patch.op === 'remove') delete value[key];
    else value[key] = patch.value;
  }
  return JSON.stringify(value);
}

export function safeRequestEndpoint(value) {
  try {
    return new URL(String(value || '')).pathname
      .split('/')
      .map((segment) => (/^[a-z0-9_-]{20,}$/i.test(segment) ? ':id' : segment))
      .join('/');
  } catch {
    return 'invalid-url';
  }
}
