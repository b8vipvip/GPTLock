export function observationMatchesPolicy(observation, policy) {
  return Boolean(
    observation?.model
      && observation?.reasoning
      && policy.lockedModels.includes(observation.model)
      && policy.allowedReasoningLevels.includes(observation.reasoning),
  );
}

export function observationConflictsPolicy(observation, policy) {
  return Boolean(
    (observation?.model && !policy.lockedModels.includes(observation.model))
      || (observation?.reasoning && !policy.allowedReasoningLevels.includes(observation.reasoning)),
  );
}

export function evaluateGuard({ state, policy, settings, inScope = true }) {
  const strict = policy.strictMode;
  const warnAllowed = !strict;
  const uiMatches = observationMatchesPolicy(state.pageObservation, policy);
  const uiConflicts = observationConflictsPolicy(state.pageObservation, policy);
  const uiComplete = Boolean(state.pageObservation?.model && state.pageObservation?.reasoning);
  const base = {
    strictMode: strict,
    canSend: warnAllowed,
    allowKind: warnAllowed ? 'warning' : 'blocked',
    status: state.phase,
    uiMatches,
    uiConflicts,
    uiComplete,
    reason: null,
  };

  if (!inScope) {
    return { ...base, canSend: true, allowKind: 'outside_scope', status: 'outside_scope' };
  }
  if (!settings.enabled) {
    return {
      ...base,
      canSend: true,
      allowKind: 'disabled',
      status: 'disabled',
      reason: 'gptlock_disabled',
    };
  }
  if (!settings.networkVerificationEnabled) {
    return { ...base, status: 'monitor_disabled', reason: 'network_monitor_disabled' };
  }
  if (!state.core?.connected) {
    return {
      ...base,
      status: 'core_offline',
      reason: state.core?.error || 'native_core_offline',
    };
  }
  if (!state.monitor.attached) {
    return {
      ...base,
      status: 'monitor_offline',
      reason: state.monitor.error || 'network_monitor_not_attached',
    };
  }
  if (!strict) {
    return {
      ...base,
      canSend: true,
      allowKind: 'warning',
      reason: state.phase === 'verified' ? null : state.lastError,
    };
  }
  if (state.phase === 'verified') {
    return { ...base, canSend: true, allowKind: 'verified', status: 'verified' };
  }
  if (state.phase === 'waiting') {
    return { ...base, status: 'waiting', reason: 'waiting_for_response_metadata' };
  }
  if (state.phase === 'mismatch') {
    return { ...base, status: 'mismatch', reason: state.lastVerification?.reason || 'policy_mismatch' };
  }
  if (state.phase === 'unverified') {
    return { ...base, status: 'unverified', reason: state.lastVerification?.reason || 'metadata_missing' };
  }
  if (state.phase === 'error') {
    return { ...base, status: 'error', reason: state.lastError || 'verification_error' };
  }
  if (state.probeArmed && !uiConflicts) {
    return { ...base, canSend: true, allowKind: 'probe', status: 'probe_ready' };
  }
  if (uiConflicts) {
    return { ...base, status: 'preflight_mismatch', reason: 'page_selection_not_allowed' };
  }
  if (!uiComplete) {
    return { ...base, status: 'preflight_unknown', reason: 'page_selection_missing' };
  }
  if (settings.firstRequestMode === 'allow_once' && !state.probeUsed) {
    return { ...base, canSend: true, allowKind: 'probe', status: 'probe_ready' };
  }
  return { ...base, status: 'initial_block', reason: 'first_probe_not_armed' };
}
