import { privateCoreChannel } from './private-core-channel.js';

const MESSAGE_TYPE = 'GPTLOCK_PRIVATE_CONTEXT_EVALUATE';
const MAX_METRIC = Number.MAX_SAFE_INTEGER;

function boundedMetric(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.min(MAX_METRIC, Math.floor(number));
}

export function sanitizePrivateContextPayload(value = {}) {
  const snapshot = value?.snapshot && typeof value.snapshot === 'object' ? value.snapshot : {};
  const profile = value?.profile && typeof value.profile === 'object' ? value.profile : {};
  return {
    snapshot: {
      hardLimitVisible: Boolean(snapshot.hardLimitVisible),
      cumulativeTokens: boundedMetric(snapshot.cumulativeTokens),
      cumulativeCharacters: boundedMetric(snapshot.cumulativeCharacters),
      cumulativeMessages: boundedMetric(snapshot.cumulativeMessages),
      fallbackSafeLimitTokens: boundedMetric(snapshot.fallbackSafeLimitTokens),
      fallbackRemainingTokens: boundedMetric(snapshot.fallbackRemainingTokens),
    },
    profile: {
      hardLimitObservedTokens: boundedMetric(profile.hardLimitObservedTokens),
      hardLimitObservedCharacters: boundedMetric(profile.hardLimitObservedCharacters),
      hardLimitObservedMessages: boundedMetric(profile.hardLimitObservedMessages),
    },
  };
}

export function normalizePrivateContextResult(value) {
  const percent = Number(value?.percent);
  if (!Number.isFinite(percent)) throw new TypeError('private context result percent is invalid');
  const source = String(value?.source ?? '').trim();
  if (!source || source.length > 96) throw new TypeError('private context result source is invalid');
  return {
    percent: Math.min(100, Math.max(0, percent)),
    source,
  };
}

function safeErrorCode(error) {
  const code = String(error?.code || '').trim();
  return /^[a-z0-9_:-]{1,80}$/i.test(code) ? code : 'private_context_unavailable';
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== MESSAGE_TYPE) return false;

  void (async () => {
    try {
      if (!(await privateCoreChannel.isAvailable())) {
        sendResponse({ ok: false, error: 'private_engine_unavailable' });
        return;
      }
      const payload = sanitizePrivateContextPayload(message.payload);
      const raw = await privateCoreChannel.request('evaluate_context', payload, 'context');
      sendResponse({ ok: true, data: normalizePrivateContextResult(raw) });
    } catch (error) {
      privateCoreChannel.invalidate();
      sendResponse({ ok: false, error: safeErrorCode(error) });
    }
  })();

  return true;
});

export { MESSAGE_TYPE as PRIVATE_CONTEXT_MESSAGE_TYPE };
