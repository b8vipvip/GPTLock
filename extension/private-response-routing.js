const MAX_HEADER_COUNT = 256;
const MAX_HEADER_NAME_LENGTH = 256;
const MAX_HEADER_VALUE_LENGTH = 16 * 1024;
const MAX_METADATA_STRING_LENGTH = 512;
const MAX_DIAGNOSTIC_KEYS = 64;

function optionalString(value) {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value);
  if (text.length > MAX_METADATA_STRING_LENGTH) throw new TypeError('private response metadata string is too long');
  return text;
}

function normalizeHeaders(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const output = {};
  for (const [key, rawValue] of Object.entries(value).slice(0, MAX_HEADER_COUNT)) {
    const name = String(key);
    const headerValue = String(rawValue ?? '');
    if (!name || name.length > MAX_HEADER_NAME_LENGTH || headerValue.length > MAX_HEADER_VALUE_LENGTH) continue;
    output[name] = headerValue;
  }
  return output;
}

function sanitizeDiagnosticValue(value, depth = 0) {
  if (depth > 3) return null;
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value.slice(0, MAX_METADATA_STRING_LENGTH);
  if (Array.isArray(value)) return value.slice(0, 32).map((entry) => sanitizeDiagnosticValue(entry, depth + 1));
  if (value && typeof value === 'object') {
    const output = {};
    for (const [key, entry] of Object.entries(value).slice(0, MAX_DIAGNOSTIC_KEYS)) {
      output[String(key).slice(0, MAX_METADATA_STRING_LENGTH)] = sanitizeDiagnosticValue(entry, depth + 1);
    }
    return output;
  }
  return null;
}

export function decodePrivateResponseBody(body, base64Encoded = false) {
  const source = String(body ?? '');
  if (!base64Encoded) return source;
  const binary = atob(source);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new TextDecoder().decode(bytes);
}

export function buildPrivateResponsePayload({ body = '', headers = {}, mimeType = '' } = {}) {
  return {
    body: String(body ?? ''),
    headers: normalizeHeaders(headers),
    mimeType: String(mimeType ?? '').slice(0, MAX_METADATA_STRING_LENGTH),
  };
}

export function normalizePrivateResponseEvidence(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('private response evidence must be an object');
  }
  const conflicts = value.conflicts && typeof value.conflicts === 'object' ? value.conflicts : {};
  const fields = value.fields && typeof value.fields === 'object' ? value.fields : {};
  return {
    model: optionalString(value.model),
    reasoning: optionalString(value.reasoning),
    conflicts: {
      model: Boolean(conflicts.model),
      reasoning: Boolean(conflicts.reasoning),
    },
    fields: {
      model: optionalString(fields.model),
      reasoning: optionalString(fields.reasoning),
    },
    diagnostics: sanitizeDiagnosticValue(value.diagnostics) || {},
  };
}

export function hasCompletePrivateResponseEvidence(evidence) {
  return Boolean(
    evidence?.model
      && evidence?.reasoning
      && !evidence?.conflicts?.model
      && !evidence?.conflicts?.reasoning,
  );
}
