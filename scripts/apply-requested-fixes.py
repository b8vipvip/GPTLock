from pathlib import Path
import re


def read(path):
    return Path(path).read_text(encoding='utf-8-sig')


def write(path, value):
    Path(path).write_text(value, encoding='utf-8', newline='\n')


def replace_once(source, old, new, label):
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected 1 anchor, got {count}')
    return source.replace(old, new, 1)


def replace_regex(source, pattern, new, label):
    compiled = re.compile(pattern, re.S)
    matches = list(compiled.finditer(source))
    if len(matches) != 1:
        raise RuntimeError(f'{label}: expected 1 regex match, got {len(matches)}')
    return compiled.sub(lambda _m: new, source, count=1)


# 1. Context: detect ChatGPT's genuine product-level conversation-length boundary,
# preserve it per account/model, and only turn it into a token upper bound when
# the underlying conversation measurement is complete enough to be trustworthy.
path = 'extension/context-budget.js'
source = read(path)
source = replace_once(source, '''  const ERROR_TEXT_PATTERNS = [
    /something went wrong/i,
    /there was an error generating/i,
    /network error/i,
    /error generating a response/i,
    /出了点问题/,
    /生成回复时出错/,
    /网络错误/,
  ];
''', '''  const ERROR_TEXT_PATTERNS = [
    /something went wrong/i,
    /there was an error generating/i,
    /network error/i,
    /error generating a response/i,
    /出了点问题/,
    /生成回复时出错/,
    /网络错误/,
  ];
  const CONVERSATION_LENGTH_LIMIT_PATTERNS = [
    { locale: 'zh-CN', pattern: /你已(?:到达|达到)(?:此)?对话的长度上限[，,。.!！\\s]*(?:你可以)?(?:开始|开启|新建)(?:一个)?新(?:聊天|对话).*继续(?:此)?对话/ },
    { locale: 'en', pattern: /(?:you(?:'|’)ve|you have) reached (?:the )?(?:maximum|max) (?:length|limit) (?:for|of) (?:this )?conversation[,.!\\s]*(?:you can )?.*(?:start|begin) (?:a )?new chat/i },
    { locale: 'en', pattern: /this conversation (?:has )?reached (?:its )?(?:maximum|max) (?:length|limit).*(?:start|begin) (?:a )?new chat/i },
  ];
  const NEW_CHAT_ACTION_PATTERN = /开始新(?:对话|聊天)|新建(?:对话|聊天)|start (?:a )?new chat|new chat/i;
''', 'context patterns')
source = replace_once(source, '''  let restoredPendingKey = null;
''', '''  let restoredPendingKey = null;
  let lastHardLimitNotice = null;
  let hardLimitLearningInFlight = false;
  let lastHardLimitFingerprint = null;
''', 'context state')
source = replace_regex(source, r'''  function computeBudget\(\{.*?\n  \}\n\n  function conversationMessageText''', '''  function computeBudget({
    historyTokens = 0,
    draftTokens = 0,
    contextLimitTokens = DEFAULT_CONTEXT_WINDOW_TOKENS,
    adaptiveSafeLimitTokens = 0,
    hardLimitUpperBoundTokens = 0,
    confirmedLowerBoundTokens = 0,
  } = {}) {
    const nominalLimit = Math.max(16_000, Number(contextLimitTokens) || DEFAULT_CONTEXT_WINDOW_TOKENS);
    const baseSafeLimitTokens = Math.floor(nominalLimit * SAFETY_BUDGET_RATIO);
    const learnedSafeLimitTokens = clampAdaptiveLimit(adaptiveSafeLimitTokens);
    const confirmedLower = clampAdaptiveLimit(confirmedLowerBoundTokens);
    const learnedHardUpper = clampAdaptiveLimit(hardLimitUpperBoundTokens);
    const hardLimitUsable = learnedHardUpper > confirmedLower;
    const unconstrainedSafeLimitTokens = Math.max(baseSafeLimitTokens, learnedSafeLimitTokens);
    const safeLimitTokens = hardLimitUsable
      ? Math.max(16_000, confirmedLower, Math.min(unconstrainedSafeLimitTokens, learnedHardUpper))
      : unconstrainedSafeLimitTokens;
    const reserveBasis = Math.max(nominalLimit, safeLimitTokens);
    const reserveTokens = reserveTokensForWindow(reserveBasis);
    const usedTokens = Math.max(0, Math.ceil(historyTokens + draftTokens));
    const projectedTokens = usedTokens + reserveTokens;
    const percent = Math.min(MAX_DISPLAY_PERCENT, (usedTokens / safeLimitTokens) * 100);
    const projectedPercent = Math.min(MAX_DISPLAY_PERCENT, (projectedTokens / safeLimitTokens) * 100);
    const remainingTokens = Math.max(0, safeLimitTokens - usedTokens);
    return {
      nominalLimitTokens: nominalLimit,
      baseSafeLimitTokens,
      adaptiveSafeLimitTokens: learnedSafeLimitTokens,
      hardLimitUpperBoundTokens: learnedHardUpper,
      confirmedLowerBoundTokens: confirmedLower,
      safeLimitTokens,
      reserveTokens,
      historyTokens: Math.max(0, Math.ceil(historyTokens)),
      draftTokens: Math.max(0, Math.ceil(draftTokens)),
      usedTokens,
      projectedTokens,
      percent,
      projectedPercent,
      remainingTokens,
      warning: percent >= WARNING_PERCENT,
      wouldExceed: projectedTokens >= safeLimitTokens,
      adaptiveActive: learnedSafeLimitTokens > baseSafeLimitTokens,
      hardLimitActive: hardLimitUsable && safeLimitTokens <= learnedHardUpper,
    };
  }

  function conversationMessageText''', 'computeBudget')
source = replace_regex(source, r'''  function nextLearnedProfile\(\{.*?\n  \}\n\n  const api = \{''', '''  function nextLearnedProfile({
    previous = null,
    accountScope,
    accountScopeSource = 'unknown',
    model,
    confirmedConversationTokens,
    confirmedCharacters = 0,
    conversationKey = 'unknown',
    measuredAt = new Date().toISOString(),
    baseSafeLimitTokens = 0,
  } = {}) {
    const normalizedModel = normalizeModelId(model);
    const confirmed = clampAdaptiveLimit(confirmedConversationTokens);
    if (!accountScope || !normalizedModel || confirmed <= 0) return null;
    const previousConfirmed = clampAdaptiveLimit(previous?.confirmedConversationTokens);
    const nextConfirmed = Math.max(previousConfirmed, confirmed);
    const candidateAdaptive = clampAdaptiveLimit(nextConfirmed + learningHeadroomTokens(nextConfirmed));
    const previousAdaptive = clampAdaptiveLimit(previous?.adaptiveSafeLimitTokens);
    const adaptiveSafeLimitTokens = Math.max(
      Math.ceil(Number(baseSafeLimitTokens) || 0), previousAdaptive, candidateAdaptive,
    );
    return {
      ...(previous && typeof previous === 'object' ? previous : {}),
      schemaVersion: 1,
      accountScope,
      accountScopeSource,
      model: normalizedModel,
      confirmedConversationTokens: nextConfirmed,
      confirmedCharacters: Math.max(
        Math.max(0, Math.ceil(Number(previous?.confirmedCharacters) || 0)),
        Math.max(0, Math.ceil(Number(confirmedCharacters) || 0)),
      ),
      adaptiveSafeLimitTokens,
      successfulBypassCount: Math.max(0, Math.floor(Number(previous?.successfulBypassCount) || 0)) + 1,
      firstConfirmedAt: previous?.firstConfirmedAt || measuredAt,
      lastConfirmedAt: measuredAt,
      lastConversationKey: String(conversationKey || 'unknown').slice(0, 256),
      evidence: 'explicit-over-limit-send+formal-request+settled-assistant-turn',
    };
  }

  function classifyConversationLengthLimitText(value) {
    const text = String(value ?? '').replace(/\\s+/g, ' ').trim().slice(0, 1_000);
    if (!text) return null;
    for (const entry of CONVERSATION_LENGTH_LIMIT_PATTERNS) {
      if (entry.pattern.test(text)) return { matched: true, locale: entry.locale, text };
    }
    return null;
  }

  function nextHardLimitProfile({
    previous = null,
    accountScope,
    accountScopeSource = 'unknown',
    model,
    observedConversationTokens = 0,
    observedCharacters = 0,
    observedMessages = 0,
    conversationKey = 'unknown',
    measuredAt = new Date().toISOString(),
    measurementSource = 'unknown',
    measurementReliable = false,
    noticeText = '',
    actionText = '',
  } = {}) {
    const normalizedModel = normalizeModelId(model);
    const account = String(accountScope ?? '').trim();
    if (!account || !normalizedModel) return null;
    const observed = clampAdaptiveLimit(observedConversationTokens);
    const confirmedLower = clampAdaptiveLimit(previous?.confirmedConversationTokens);
    const previousUpper = clampAdaptiveLimit(previous?.hardLimitUpperBoundTokens);
    const usableObservation = Boolean(measurementReliable && observed > confirmedLower);
    const hardLimitUpperBoundTokens = usableObservation
      ? (previousUpper > confirmedLower ? Math.min(previousUpper, observed) : observed)
      : previousUpper;
    return {
      ...(previous && typeof previous === 'object' ? previous : {}),
      schemaVersion: 1,
      accountScope: account,
      accountScopeSource,
      model: normalizedModel,
      hardLimitObserved: true,
      hardLimitObservedCount: Math.max(0, Math.floor(Number(previous?.hardLimitObservedCount) || 0)) + 1,
      hardLimitObservedTokens: observed,
      hardLimitObservedCharacters: Math.max(0, Math.ceil(Number(observedCharacters) || 0)),
      hardLimitObservedMessages: Math.max(0, Math.ceil(Number(observedMessages) || 0)),
      hardLimitUpperBoundTokens,
      hardLimitTokenCapUsable: hardLimitUpperBoundTokens > confirmedLower,
      hardLimitConfidence: usableObservation ? 'measured-upper-bound' : 'ui-boundary-only',
      hardLimitMeasurementSource: String(measurementSource || 'unknown').slice(0, 80),
      hardLimitLastObservedAt: measuredAt,
      hardLimitLastConversationKey: String(conversationKey || 'unknown').slice(0, 256),
      hardLimitLastText: String(noticeText || '').replace(/\\s+/g, ' ').trim().slice(0, 500),
      hardLimitActionText: String(actionText || '').replace(/\\s+/g, ' ').trim().slice(0, 120),
      hardLimitEvidence: 'chatgpt-visible-conversation-length-limit',
    };
  }

  const api = {''', 'profile helpers')
source = replace_once(source, '''    nextLearnedProfile,
    extractConversationMetrics,
''', '''    nextLearnedProfile,
    classifyConversationLengthLimitText,
    nextHardLimitProfile,
    extractConversationMetrics,
''', 'api exports')
source = replace_once(source, '''  function visible(element) {
    const rect = element?.getBoundingClientRect?.();
    return Boolean(rect && rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== 'hidden');
  }

  function findComposer() {
''', '''  function visible(element) {
    const rect = element?.getBoundingClientRect?.();
    return Boolean(rect && rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== 'hidden');
  }

  function findVisibleConversationLengthLimit() {
    const candidates = [...document.querySelectorAll('p,[role="alert"],[role="status"]')].filter(visible);
    for (const element of candidates) {
      if (element.closest('#gptlock-context-warning-host,#gptlock-context-learning-toast,#gptlock-context-hard-limit-toast')) continue;
      const match = classifyConversationLengthLimitText(elementText(element));
      if (!match) continue;
      let actionText = '';
      let container = element;
      for (let depth = 0; depth < 7 && container; depth += 1, container = container.parentElement) {
        const action = [...(container.querySelectorAll?.('button,a') || [])]
          .find((candidate) => visible(candidate) && NEW_CHAT_ACTION_PATTERN.test(elementText(candidate).trim()));
        if (action) { actionText = elementText(action).trim(); break; }
      }
      const insideConversationTurn = Boolean(element.closest('[data-message-author-role],article[data-testid^="conversation-turn-"]'));
      const semanticNotice = ['alert', 'status'].includes(String(element.getAttribute('role') || '').toLowerCase());
      if (!actionText && insideConversationTurn && !semanticNotice) continue;
      return { ...match, actionText: actionText.slice(0, 120) };
    }
    return null;
  }

  function findComposer() {
''', 'DOM detector')
source = replace_regex(source, r'''  function activeAdaptiveLimit\(model\) \{.*?\n  \}\n\n  function snapshotNow\(\) \{''', '''  function activeAdaptiveLimit(model) {
    const normalizedModel = normalizeModelId(model);
    if (!activeProfile || !currentAccountScope || !normalizedModel) return 0;
    if (activeProfile.accountScope !== currentAccountScope || activeProfile.model !== normalizedModel) return 0;
    return clampAdaptiveLimit(activeProfile.adaptiveSafeLimitTokens);
  }

  function activeHardLimit(model) {
    const normalizedModel = normalizeModelId(model);
    if (!activeProfile || !currentAccountScope || !normalizedModel) return { upper: 0, confirmed: 0 };
    if (activeProfile.accountScope !== currentAccountScope || normalizeModelId(activeProfile.model) !== normalizedModel) return { upper: 0, confirmed: 0 };
    return {
      upper: clampAdaptiveLimit(activeProfile.hardLimitUpperBoundTokens),
      confirmed: clampAdaptiveLimit(activeProfile.confirmedConversationTokens),
    };
  }

  function snapshotNow() {''', 'active limit helper')
source = replace_once(source, '''    const adaptiveSafeLimitTokens = activeAdaptiveLimit(windowProfile.model);
    const budget = computeBudget({
      historyTokens: history.tokens,
      draftTokens,
      contextLimitTokens: windowProfile.tokens,
      adaptiveSafeLimitTokens,
    });
''', '''    const adaptiveSafeLimitTokens = activeAdaptiveLimit(windowProfile.model);
    const learnedHardLimit = activeHardLimit(windowProfile.model);
    const budget = computeBudget({
      historyTokens: history.tokens,
      draftTokens,
      contextLimitTokens: windowProfile.tokens,
      adaptiveSafeLimitTokens,
      hardLimitUpperBoundTokens: learnedHardLimit.upper,
      confirmedLowerBoundTokens: learnedHardLimit.confirmed,
    });
''', 'snapshot applies hard bound')
source = replace_once(source, '''      learnedAt: budget.adaptiveActive ? activeProfile?.lastConfirmedAt ?? null : null,
      accountScopeAvailable: Boolean(currentAccountScope),
''', '''      learnedAt: budget.adaptiveActive ? activeProfile?.lastConfirmedAt ?? null : null,
      hardLimitVisible: Boolean(lastHardLimitNotice && lastHardLimitNotice.conversationKey === currentConversationKey()),
      hardLimitObservedTokens: clampAdaptiveLimit(activeProfile?.hardLimitObservedTokens),
      hardLimitObservedCount: Math.max(0, Number(activeProfile?.hardLimitObservedCount) || 0),
      hardLimitConfidence: activeProfile?.hardLimitConfidence ?? (lastHardLimitNotice ? 'ui-boundary-only' : null),
      hardLimitMeasurementSource: activeProfile?.hardLimitMeasurementSource ?? null,
      hardLimitLastObservedAt: activeProfile?.hardLimitLastObservedAt ?? null,
      accountScopeAvailable: Boolean(currentAccountScope),
''', 'snapshot metadata')
source = replace_once(source, '''    if (snapshot.adaptiveActive) {
''', '''    if (snapshot.hardLimitVisible || snapshot.hardLimitObservedCount > 0) {
      if (snapshot.hardLimitUpperBoundTokens > snapshot.confirmedLowerBoundTokens) {
        const lower = snapshot.confirmedLowerBoundTokens > 0 ? `；已确认成功下限 ≥ ${formatCompactTokens(snapshot.confirmedLowerBoundTokens)}` : '';
        rows.push(`ChatGPT 实测会话硬上限：≤ ${formatCompactTokens(snapshot.hardLimitUpperBoundTokens)} tokens${lower}（真实“对话长度上限”界面提示）`);
      } else {
        rows.push('ChatGPT 实测会话硬上限：已检测到真实“对话长度上限”提示；当前只有 DOM/不完整历史估算，因此暂不把该 token 数写成可信上限。');
      }
    }
    if (snapshot.adaptiveActive) {
''', 'indicator hard-bound row')
source = replace_once(source, '''      '说明：插件优先读取当前会话 conversation tree 并沿 current_node 活动分支统计，再与 DOM 新内容取较大值；读取失败时退回 DOM。ChatGPT 隐藏系统提示、服务端压缩/裁剪和精确 tokenizer 仍不对扩展完整开放，因此“实测成功下限”代表该活动会话长度下服务仍成功生成，不等同于官方物理上下文窗口。',
''', '''      '说明：插件优先读取当前会话 conversation tree 并沿 current_node 活动分支统计，再与 DOM 新内容取较大值；读取失败时退回 DOM。真实“对话长度上限”提示可以证明 ChatGPT 产品层已经封顶，但提示本身不包含官方 token 数；只有历史测量完整时才会形成可用于发送预算的 token 上界。ChatGPT 隐藏系统提示、服务端压缩/裁剪和精确 tokenizer 仍不对扩展完整开放，因此实测上下界都不等同于官方物理模型窗口。',
''', 'indicator caveat')
source = replace_once(source, '''  function recompute() {
    refreshTimer = null;
    try {
      publishSnapshot(snapshotNow());
      void refreshConversationMetrics();
      void maybeFinalizeBypassLearning();
    } catch {
      // ChatGPT DOM can be replaced during navigation; the periodic refresh self-heals.
    }
  }
''', '''  function recompute() {
    refreshTimer = null;
    try {
      const notice = findVisibleConversationLengthLimit();
      if (notice) lastHardLimitNotice = { ...notice, conversationKey: currentConversationKey(), detectedAt: new Date().toISOString() };
      const next = snapshotNow();
      publishSnapshot(next);
      if (notice) void persistHardLimitObservation(next, lastHardLimitNotice);
      void refreshConversationMetrics();
      void maybeFinalizeBypassLearning();
    } catch {
      // ChatGPT DOM can be replaced during navigation; the periodic refresh self-heals.
    }
  }
''', 'recompute detector')
source = replace_once(source, '''  function hasVisibleGenerationError() {
    const candidates = [
      ...document.querySelectorAll('[role="alert"],[data-testid*="error" i],[class*="error" i]'),
    ].filter(visible);
    return candidates.some((element) => {
      const text = elementText(element).trim();
      return text && ERROR_TEXT_PATTERNS.some((pattern) => pattern.test(text));
    });
  }
''', '''  function hasVisibleGenerationError() {
    if (findVisibleConversationLengthLimit()) return true;
    const candidates = [
      ...document.querySelectorAll('[role="alert"],[data-testid*="error" i],[class*="error" i]'),
    ].filter(visible);
    return candidates.some((element) => {
      const text = elementText(element).trim();
      return text && ERROR_TEXT_PATTERNS.some((pattern) => pattern.test(text));
    });
  }
''', 'limit is not a successful bypass')
source = replace_once(source, '''  async function refreshAccountScope(force = false) {
''', '''  async function persistHardLimitObservation(snapshot, notice) {
    if (!snapshot || !notice || hardLimitLearningInFlight) return null;
    const model = normalizeModelId(snapshot.model) || detectModel();
    const observedTokens = Math.max(
      Math.ceil(Number(snapshot.fullConversationTokens) || 0),
      Math.ceil(Number(snapshot.cumulativeConversationTokens) || 0),
    );
    const fingerprint = `${snapshot.conversationKey}:${model}:${snapshot.historyMeasurementSource}:${observedTokens}`;
    if (lastHardLimitFingerprint === fingerprint) return activeProfile;
    hardLimitLearningInFlight = true;
    try {
      if (!currentAccountScope) await refreshAccountScope(true);
      const key = profileStorageKey(currentAccountScope, model);
      if (!key) return null;
      const stored = await chrome.storage.local.get(key);
      const previous = stored[key] ?? null;
      const measurementReliable = ['conversation-tree+dom-reconcile', 'checkpoint+dom-restore'].includes(snapshot.historyMeasurementSource);
      const next = nextHardLimitProfile({
        previous,
        accountScope: currentAccountScope,
        accountScopeSource: currentAccountScopeSource || 'unknown',
        model,
        observedConversationTokens: observedTokens,
        observedCharacters: Math.max(snapshot.fullConversationCharacters || 0, snapshot.cumulativeConversationCharacters || 0),
        observedMessages: Math.max(snapshot.messageCount || 0, snapshot.cumulativeMessageCount || 0),
        conversationKey: snapshot.conversationKey,
        measuredAt: new Date().toISOString(),
        measurementSource: snapshot.historyMeasurementSource,
        measurementReliable,
        noticeText: notice.text,
        actionText: notice.actionText,
      });
      if (!next) return null;
      await chrome.storage.local.set({ [key]: next });
      activeProfile = next;
      activeProfileKey = key;
      lastLoadedProfileModel = model;
      lastHardLimitFingerprint = fingerprint;
      await discardPendingBypass();
      window.dispatchEvent(new CustomEvent('gptlock:context-hard-limit-learned', {
        detail: {
          model,
          conversationKey: snapshot.conversationKey,
          hardLimitUpperBoundTokens: next.hardLimitUpperBoundTokens || 0,
          observedConversationTokens: observedTokens,
          confidence: next.hardLimitConfidence,
          measurementSource: snapshot.historyMeasurementSource,
        },
      }));
      showHardLimitToast(next);
      scheduleRefresh();
      return next;
    } catch {
      return null;
    } finally {
      hardLimitLearningInFlight = false;
    }
  }

  async function refreshAccountScope(force = false) {
''', 'persist hard observation')
source = replace_once(source, '''  document.addEventListener('click', handlePotentialSend, true);
''', '''  function showHardLimitToast(profile) {
    const existing = document.getElementById('gptlock-context-hard-limit-toast');
    existing?.remove();
    const host = document.createElement('div');
    host.id = 'gptlock-context-hard-limit-toast';
    host.style.cssText = 'all:initial;position:fixed;right:18px;bottom:86px;z-index:2147483647;pointer-events:none';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>.toast{max-width:460px;padding:11px 13px;border-radius:12px;background:#fff7ed;color:#9a3412;border:1px solid #fdba74;box-shadow:0 12px 30px rgba(154,52,18,.14);font:650 12px/1.45 system-ui,sans-serif}</style>
      <div class="toast"></div>`;
    const upper = clampAdaptiveLimit(profile?.hardLimitUpperBoundTokens);
    root.querySelector('.toast').textContent = upper
      ? `GPTLock 已捕获 ChatGPT 真实“对话长度上限”提示，并记录该账户/模型的实测上界 ≤ ${formatCompactTokens(upper)} tokens。后续发送预算会同时受成功下限与该上界约束。`
      : 'GPTLock 已捕获 ChatGPT 真实“对话长度上限”提示。当前会话历史只能从 DOM 回退估算，数据不完整，因此不会把这个不完整 token 数误写成最大上限；事件已记录，后续会继续对账。';
    document.documentElement.append(host);
    window.setTimeout(() => host.remove(), 7_000);
  }

  document.addEventListener('click', handlePotentialSend, true);
''', 'hard limit toast')
source = replace_once(source, '''    conversationMetricsCheckedAt = 0;
    scheduleRefresh();
''', '''    conversationMetricsCheckedAt = 0;
    lastHardLimitNotice = null;
    lastHardLimitFingerprint = null;
    scheduleRefresh();
''', 'navigation reset')
write(path, source)


# 2. Account migration compatibility: stale popup resources from an in-place update
# must not fail with Unsupported extension message: GPTLOCK-LICENSE-GET.
path = 'extension/background.js'
source = read(path)
source = replace_once(source, '''      case 'GPTLOCK_ACCOUNT_CONFIG':
        return accountClient.config();
''', '''      case 'GPTLOCK-LICENSE-GET':
      case 'GPTLOCK_LICENSE_GET': {
        const entitlement = accountState?.entitlement || null;
        const authorized = Boolean(accountState?.authenticated && entitlement?.active);
        return {
          authorized,
          status: authorized ? 'active' : 'migrated_to_account',
          legacyUi: true,
          accountRequired: true,
          licenseRequired: false,
          license: authorized ? {
            expiresAt: entitlement?.expiresAt ?? null,
            limits: entitlement?.limits ?? null,
            usage: entitlement?.usage ?? null,
            label: 'GPTLock account entitlement',
          } : null,
          lastError: authorized
            ? '旧授权码界面已停用；当前授权来自 GPTLock 账号权益。关闭并重新打开扩展弹窗即可加载新版界面。'
            : '授权码已停用；GPTLock 当前使用账号登录与会员权益。关闭并重新打开扩展弹窗，必要时完全重启浏览器。',
        };
      }
      case 'GPTLOCK-LICENSE-ACTIVATE':
      case 'GPTLOCK_LICENSE_ACTIVATE':
        throw Object.assign(new Error('授权码验证已停用；GPTLock 当前使用账号登录。检测到旧版弹窗资源，请关闭弹窗并重新打开，必要时完全重启浏览器。'), { code: 'LICENSE_UI_STALE' });
      case 'GPTLOCK-LICENSE-CLEAR':
      case 'GPTLOCK_LICENSE_CLEAR':
        return { cleared: true, legacyUi: true, accountRequired: true, licenseRequired: false };
      case 'GPTLOCK_ACCOUNT_CONFIG':
        return accountClient.config();
''', 'legacy license bridge')
write(path, source)


# 3. Server-side user editing + admin password reset.
path = 'license-server/account-system.mjs'
source = read(path)
source = replace_regex(source, r'''      if \(userMatch && req\.method === 'PATCH'\) \{.*?\n      \}\n\n      const resetDevicesMatch''', '''      if (userMatch && req.method === 'PATCH') {
        const user = userById(Number(userMatch[1]));
        if (!user) fail(404, 'USER_NOT_FOUND', '用户不存在');
        const input = await bodyJson(req);
        let email = user.email;
        if (input.email !== undefined) {
          email = normalizeEmail(input.email);
          if (!isEmail(email)) fail(400, 'INVALID_EMAIL', '请输入有效邮箱');
          const duplicate = userByEmail(email);
          if (duplicate && duplicate.id !== user.id) fail(409, 'ACCOUNT_EXISTS', '该邮箱已被其他用户使用');
        }
        const status = ['active', 'disabled', 'pending'].includes(input.status) ? input.status : user.status;
        let freeExpiresAt = input.freeExpiresAt === null ? null : (parseIso(input.freeExpiresAt) || user.free_expires_at);
        const membership = currentMembership(user.id);
        let membershipExpiresAt = membership?.expires_at || null;
        if (Object.prototype.hasOwnProperty.call(input, 'entitlementExpiresAt')) {
          if (membership) {
            const parsed = parseIso(input.entitlementExpiresAt);
            if (!parsed) fail(400, 'INVALID_ENTITLEMENT_EXPIRY', '会员有效期不能为空且必须是有效日期');
            if (Date.parse(parsed) <= Date.parse(membership.starts_at)) fail(400, 'INVALID_ENTITLEMENT_EXPIRY', '会员有效期必须晚于会员开始时间');
            db.prepare('UPDATE memberships SET expires_at=? WHERE id=?').run(parsed, membership.id);
            membershipExpiresAt = parsed;
          } else {
            freeExpiresAt = input.entitlementExpiresAt === null ? null : parseIso(input.entitlementExpiresAt);
            if (input.entitlementExpiresAt !== null && !freeExpiresAt) fail(400, 'INVALID_ENTITLEMENT_EXPIRY', '免费权益有效期格式无效');
          }
        }
        const maxDevicesOverride = input.maxDevicesOverride === null ? null : clampInt(input.maxDevicesOverride, 1, 1000, user.max_devices_override ?? 1);
        const maxWindowsOverride = input.maxWindowsOverride === null ? null : clampInt(input.maxWindowsOverride, 1, 1000, user.max_windows_override ?? 1);
        db.prepare(`UPDATE users SET email=?,status=?,free_expires_at=?,max_devices_override=?,max_windows_override=?,updated_at=? WHERE id=?`)
          .run(email, status, freeExpiresAt, maxDevicesOverride, maxWindowsOverride, nowIso(), user.id);
        if (status === 'disabled') {
          db.prepare('UPDATE user_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL').run(nowIso(), user.id);
        }
        audit('admin_user_updated', user.id, {
          emailChanged: email !== user.email, status, freeExpiresAt, membershipId: membership?.id || null,
          membershipExpiresAt, maxDevicesOverride, maxWindowsOverride,
        });
        return json(res, 200, { ok: true, user: adminUserRow(userById(user.id)) }), true;
      }

      const adminPasswordMatch = path.match(/^\\/admin\\/api\\/account\\/users\\/(\\d+)\\/password$/);
      if (adminPasswordMatch && req.method === 'POST') {
        const user = userById(Number(adminPasswordMatch[1]));
        if (!user) fail(404, 'USER_NOT_FOUND', '用户不存在');
        const input = await bodyJson(req);
        if (!passwordValid(input.password)) fail(400, 'WEAK_PASSWORD', '新密码至少 10 位，最多 128 位');
        const passwordHash = await encodePassword(input.password);
        const changedAt = nowIso();
        db.exec('BEGIN IMMEDIATE');
        try {
          db.prepare('UPDATE users SET password_hash=?,updated_at=? WHERE id=?').run(passwordHash, changedAt, user.id);
          db.prepare('DELETE FROM user_window_leases WHERE session_id IN (SELECT id FROM user_sessions WHERE user_id=?)').run(user.id);
          db.prepare('UPDATE user_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL').run(changedAt, user.id);
          db.exec('COMMIT');
        } catch (error) {
          try { db.exec('ROLLBACK'); } catch {}
          throw error;
        }
        audit('admin_user_password_changed', user.id, { allSessionsRevoked: true });
        return json(res, 200, { ok: true, user: adminUserRow(userById(user.id)), sessionsRevoked: true }), true;
      }

      const resetDevicesMatch''', 'admin PATCH/password route')
write(path, source)


# 4. Admin HTML/CSS/JS: direct inline editing and centered password dialog.
path = 'license-server/public/admin.html'
source = read(path)
source = replace_once(source, '''        <div class="table-wrap"><table><thead><tr><th>ID</th><th>邮箱</th><th>状态</th><th>权益</th><th>设备</th><th>窗口</th><th>有效期</th><th>操作</th></tr></thead><tbody id="usersBody"></tbody></table></div>
''', '''        <div class="table-wrap"><table class="users-table"><thead><tr><th>ID</th><th>邮箱</th><th>状态</th><th>权益 / 套餐</th><th>设备上限</th><th>窗口上限</th><th>有效期</th><th>操作</th></tr></thead><tbody id="usersBody"></tbody></table></div>
''', 'user table headers')
source = replace_once(source, '''</div>
<script type="module" src="/admin.js"></script>
''', '''</div>

<dialog id="userPasswordDialog" class="admin-dialog">
  <div class="dialog-head"><div><h2>修改用户密码</h2><p class="muted" id="userPasswordTarget">—</p></div><button id="userPasswordClose" type="button" aria-label="关闭">×</button></div>
  <div class="dialog-body">
    <label>新密码<input id="userPasswordNew" type="password" autocomplete="new-password" placeholder="至少 10 位，最多 128 位"></label>
    <label>确认新密码<input id="userPasswordConfirm" type="password" autocomplete="new-password" placeholder="再次输入新密码"></label>
    <p class="dialog-note">保存后该用户现有登录会话会全部失效，需要使用新密码重新登录。密码只会以 scrypt 哈希保存。</p>
    <p id="userPasswordMessage" class="message"></p>
  </div>
  <div class="dialog-actions"><button id="userPasswordCancel" type="button">取消</button><button id="userPasswordSubmit" class="primary" type="button">保存新密码</button></div>
</dialog>

<script type="module" src="/admin.js"></script>
''', 'password dialog HTML')
write(path, source)

path = 'license-server/public/admin.css'
source = read(path)
source += '''
.users-table td{vertical-align:top}.user-email-input{min-width:190px}.user-status-select{min-width:92px}.entitlement-editor{display:grid;gap:6px;min-width:190px}.entitlement-editor strong{font-size:11px}.compact-edit{display:flex;gap:5px;align-items:center}.compact-edit select{min-width:118px}.compact-edit button{white-space:nowrap}.limit-editor{display:grid;grid-template-columns:72px auto;gap:5px;align-items:center;min-width:138px}.limit-editor small,.expiry-editor small,.entitlement-editor small{color:#64748b;font-size:10px;line-height:1.35}.expiry-editor{display:grid;gap:5px;min-width:176px}.expiry-editor input{min-width:170px}.row-actions.user-actions{align-items:flex-start;flex-wrap:wrap;min-width:245px}.row-message{display:block;width:100%;max-width:250px;white-space:normal;font-size:10px;color:#64748b;line-height:1.35}.row-message.good{color:#15803d}.row-message.bad{color:#b91c1c}.admin-dialog{width:min(520px,calc(100vw - 28px));padding:0;border:1px solid #dbe3ef;border-radius:18px;box-shadow:0 24px 70px rgba(15,23,42,.28);color:#172033}.admin-dialog::backdrop{background:rgba(15,23,42,.42);backdrop-filter:blur(2px)}.dialog-head{display:flex;justify-content:space-between;align-items:flex-start;padding:18px 20px 12px;border-bottom:1px solid #eef2f7}.dialog-head h2{margin:0;font-size:18px}.dialog-head button{border:0;font-size:22px;line-height:1;padding:3px 8px}.dialog-body{display:grid;gap:12px;padding:18px 20px}.dialog-note{margin:0;padding:10px 11px;border-radius:10px;background:#f8fafc;color:#64748b;font-size:11px;line-height:1.5}.dialog-actions{display:flex;justify-content:flex-end;gap:8px;padding:12px 20px 18px}@media(max-width:760px){.user-email-input{min-width:160px}.row-actions.user-actions{min-width:210px}}
'''
write(path, source)

path = 'license-server/public/admin.js'
source = read(path)
source = replace_once(source, '''  generateUserPassword: $('generateUserPassword'), createUserSubmit: $('createUserSubmit'), createUserMessage: $('createUserMessage'),
''', '''  generateUserPassword: $('generateUserPassword'), createUserSubmit: $('createUserSubmit'), createUserMessage: $('createUserMessage'),
  userPasswordDialog: $('userPasswordDialog'), userPasswordTarget: $('userPasswordTarget'), userPasswordNew: $('userPasswordNew'),
  userPasswordConfirm: $('userPasswordConfirm'), userPasswordMessage: $('userPasswordMessage'), userPasswordClose: $('userPasswordClose'),
  userPasswordCancel: $('userPasswordCancel'), userPasswordSubmit: $('userPasswordSubmit'),
''', 'password DOM refs')
source = replace_regex(source, r'''function promptNumber\(.*?\n\}\n\nfunction renderDashboard''', '''function inputControl(type, value = '', attributes = {}) {
  const node = document.createElement('input');
  node.type = type; node.value = value ?? '';
  for (const [key, attributeValue] of Object.entries(attributes)) {
    if (attributeValue !== null && attributeValue !== undefined) node.setAttribute(key, String(attributeValue));
  }
  return node;
}
function selectControl(options, selected) {
  const node = document.createElement('select');
  for (const [value, label] of options) {
    const option = document.createElement('option'); option.value = value; option.textContent = label; option.selected = value === selected; node.append(option);
  }
  return node;
}
function armInlineConfirm(node, label = '再次点击确认') {
  const now = Date.now();
  if (Number(node.dataset.confirmUntil || 0) > now) {
    node.dataset.confirmUntil = '0';
    return true;
  }
  const original = node.textContent;
  node.dataset.confirmUntil = String(now + 4000);
  node.textContent = label;
  setTimeout(() => {
    if (Number(node.dataset.confirmUntil || 0) <= Date.now()) { node.textContent = original; node.dataset.confirmUntil = '0'; }
  }, 4100);
  return false;
}

function renderDashboard''', 'remove prompt helper')
source = replace_regex(source, r'''async function editUser\(row\) \{.*?\n\}\n\nasync function toggleUser\(row\) \{.*?\n\}\n\nasync function grantMembership\(row\) \{.*?\n\}\n\nasync function resetDevices\(row\) \{.*?\n\}\n\nfunction renderUsers\(rows\) \{.*?\n\}\n\nasync function loadUsers''', '''async function saveUserRow(row, controls, messageNode) {
  const email = controls.email.value.trim();
  if (!email) throw new Error('邮箱不能为空');
  let entitlementExpiresAt = null;
  if (controls.expiry.value) {
    const date = new Date(controls.expiry.value);
    if (Number.isNaN(date.getTime())) throw new Error('有效期格式无效');
    entitlementExpiresAt = date.toISOString();
  } else if (row.membership) {
    throw new Error('当前是会员权益，会员有效期不能为空');
  }
  const body = {
    email,
    status: controls.status.value,
    entitlementExpiresAt,
    maxDevicesOverride: optionalPositiveInt(controls.devices, '设备上限'),
    maxWindowsOverride: optionalPositiveInt(controls.windows, '窗口上限'),
  };
  setMessage(messageNode, '正在保存…');
  await api(`/admin/api/account/users/${row.id}`, { method: 'PATCH', body: JSON.stringify(body) });
  setMessage(messageNode, '用户信息与权益已保存。', 'good');
  await Promise.all([loadUsers(), loadDashboard()]);
}

async function grantMembership(row, planCode, messageNode) {
  const plan = plansCache.find((item) => item.enabled && item.code === planCode);
  if (!plan) throw new Error('请选择有效会员套餐');
  setMessage(messageNode, `正在为 ${row.email} 开通 ${plan.name}…`);
  await api(`/admin/api/account/users/${row.id}/grant-membership`, { method: 'POST', body: JSON.stringify({ planCode: plan.code }) });
  setMessage(messageNode, `${plan.name} 已开通/续期。`, 'good');
  await Promise.all([loadUsers(), loadDashboard()]);
}

async function resetDevices(row, messageNode) {
  setMessage(messageNode, '正在重置设备…');
  await api(`/admin/api/account/users/${row.id}/reset-devices`, { method: 'POST', body: '{}' });
  setMessage(messageNode, '设备绑定与登录会话已清空。', 'good');
  await loadUsers();
}

function openUserPasswordDialog(row) {
  el.userPasswordDialog.dataset.userId = String(row.id);
  el.userPasswordTarget.textContent = `${row.email} · 用户 #${row.id}`;
  el.userPasswordNew.value = '';
  el.userPasswordConfirm.value = '';
  setMessage(el.userPasswordMessage, '');
  el.userPasswordDialog.showModal();
  el.userPasswordNew.focus();
}

function closeUserPasswordDialog() {
  if (el.userPasswordDialog.open) el.userPasswordDialog.close();
  el.userPasswordDialog.dataset.userId = '';
  el.userPasswordNew.value = '';
  el.userPasswordConfirm.value = '';
  setMessage(el.userPasswordMessage, '');
}

async function submitUserPassword() {
  const userId = Number(el.userPasswordDialog.dataset.userId);
  const password = el.userPasswordNew.value;
  if (!Number.isInteger(userId) || userId <= 0) throw new Error('用户记录无效，请关闭后重试');
  if (password.length < 10 || password.length > 128) throw new Error('新密码必须为 10–128 位');
  if (password !== el.userPasswordConfirm.value) throw new Error('两次输入的新密码不一致');
  el.userPasswordSubmit.disabled = true;
  setMessage(el.userPasswordMessage, '正在安全更新密码并注销旧会话…');
  try {
    await api(`/admin/api/account/users/${userId}/password`, { method: 'POST', body: JSON.stringify({ password }) });
    setMessage(el.userPasswordMessage, '密码已修改，旧登录会话已全部失效。', 'good');
    el.userPasswordNew.value = '';
    el.userPasswordConfirm.value = '';
    setTimeout(closeUserPasswordDialog, 900);
  } finally {
    el.userPasswordSubmit.disabled = false;
  }
}

function renderUsers(rows) {
  el.usersBody.textContent = '';
  const enabledPlans = plansCache.filter((plan) => plan.enabled);
  for (const row of rows) {
    const tr = document.createElement('tr');
    tr.append(td(row.id));

    const emailCell = document.createElement('td');
    const email = inputControl('email', row.email, { autocomplete: 'off', 'aria-label': `用户 ${row.id} 邮箱` });
    email.className = 'user-email-input'; emailCell.append(email); tr.append(emailCell);

    const statusCell = document.createElement('td');
    const status = selectControl([['active', '启用'], ['pending', '待验证'], ['disabled', '停用']], row.status);
    status.className = 'user-status-select'; statusCell.append(status);
    const verification = document.createElement('small'); verification.className = (row.emailVerified || row.emailVerificationExempt) ? 'tone-good' : 'tone-wait';
    verification.textContent = row.emailVerified ? '邮箱已验证' : (row.emailVerificationExempt ? '免邮箱验证' : '邮箱未验证');
    statusCell.append(document.createElement('br'), verification); tr.append(statusCell);

    const entitlementCell = document.createElement('td');
    const entitlement = document.createElement('div'); entitlement.className = 'entitlement-editor';
    const tier = document.createElement('strong'); tier.textContent = accountTier(row);
    const planRow = document.createElement('div'); planRow.className = 'compact-edit';
    const planSelect = selectControl(enabledPlans.map((plan) => [plan.code, plan.name]), row.membership?.planCode || enabledPlans[0]?.code || '');
    const rowMessage = document.createElement('span'); rowMessage.className = 'row-message';
    const grant = button(row.membership ? '续期' : '开通', () => {
      if (!armInlineConfirm(grant, '再次点击确认')) return;
      grant.disabled = true;
      void grantMembership(row, planSelect.value, rowMessage).catch((error) => setMessage(rowMessage, error.message, 'bad')).finally(() => { grant.disabled = false; });
    }, 'primary');
    if (!enabledPlans.length) { planSelect.disabled = true; grant.disabled = true; }
    planRow.append(planSelect, grant);
    const tierNote = document.createElement('small'); tierNote.textContent = row.membership ? `当前会员 #${row.membership.id}` : (row.entitlement?.source === 'free' ? '当前使用免费权益' : '当前无有效权益');
    entitlement.append(tier, planRow, tierNote); entitlementCell.append(entitlement); tr.append(entitlementCell);

    const devicesCell = document.createElement('td'); const devicesWrap = document.createElement('div'); devicesWrap.className = 'limit-editor';
    const devices = inputControl('number', row.overrides?.devices ?? '', { min: 1, max: 1000, placeholder: '默认' });
    const devicesUsage = document.createElement('small'); devicesUsage.textContent = `已用 ${row.entitlement?.usage?.devices ?? 0} / 生效 ${row.entitlement?.limits?.devices ?? 0}`;
    devicesWrap.append(devices, devicesUsage); devicesCell.append(devicesWrap); tr.append(devicesCell);

    const windowsCell = document.createElement('td'); const windowsWrap = document.createElement('div'); windowsWrap.className = 'limit-editor';
    const windows = inputControl('number', row.overrides?.windows ?? '', { min: 1, max: 1000, placeholder: '默认' });
    const windowsUsage = document.createElement('small'); windowsUsage.textContent = `已用 ${row.entitlement?.usage?.windows ?? 0} / 生效 ${row.entitlement?.limits?.windows ?? 0}`;
    windowsWrap.append(windows, windowsUsage); windowsCell.append(windowsWrap); tr.append(windowsCell);

    const expiryCell = document.createElement('td'); const expiryWrap = document.createElement('div'); expiryWrap.className = 'expiry-editor';
    const expiry = inputControl('datetime-local', localDateInput(row.entitlement?.expiresAt));
    const expiryNote = document.createElement('small'); expiryNote.textContent = row.membership ? '修改当前会员到期时间' : '修改免费权益到期时间';
    expiryWrap.append(expiry, expiryNote); expiryCell.append(expiryWrap); tr.append(expiryCell);

    const actions = document.createElement('td'); actions.className = 'row-actions user-actions';
    const save = button('保存信息/权益', () => {
      save.disabled = true;
      void saveUserRow(row, { email, status, devices, windows, expiry }, rowMessage)
        .catch((error) => setMessage(rowMessage, error.message, 'bad')).finally(() => { save.disabled = false; });
    }, 'primary');
    const password = button('修改密码', () => openUserPasswordDialog(row));
    const reset = button('重置设备', () => {
      if (!armInlineConfirm(reset, '再次点击重置')) return;
      reset.disabled = true;
      void resetDevices(row, rowMessage).catch((error) => setMessage(rowMessage, error.message, 'bad')).finally(() => { reset.disabled = false; });
    }, 'danger');
    actions.append(save, password, reset, rowMessage);
    tr.append(actions);
    el.usersBody.append(tr);
  }
  if (!rows.length) {
    const tr = document.createElement('tr');
    const cell = td('没有匹配用户'); cell.colSpan = 8; cell.className = 'empty'; tr.append(cell); el.usersBody.append(tr);
  }
}

async function loadUsers''', 'inline users UI')
source = replace_once(source, '''el.refreshOrders.addEventListener('click', () => void loadOrders());
''', '''el.userPasswordClose.addEventListener('click', closeUserPasswordDialog);
el.userPasswordCancel.addEventListener('click', closeUserPasswordDialog);
el.userPasswordDialog.addEventListener('cancel', (event) => { event.preventDefault(); closeUserPasswordDialog(); });
el.userPasswordSubmit.addEventListener('click', () => {
  void submitUserPassword().catch((error) => setMessage(el.userPasswordMessage, error.message, 'bad'));
});
el.userPasswordConfirm.addEventListener('keydown', (event) => { if (event.key === 'Enter') el.userPasswordSubmit.click(); });
el.refreshOrders.addEventListener('click', () => void loadOrders());
''', 'dialog bindings')
write(path, source)


# 5. Tests.
path = 'extension/tests/context-budget.test.mjs'
source = read(path)
source += '''

test('recognizes ChatGPT real conversation-length boundary text in Chinese and English', () => {
  const zh = budget.classifyConversationLengthLimitText('你已到达此对话的长度上限，你可以开始新聊天以继续对话。');
  assert.equal(zh?.locale, 'zh-CN');
  const en = budget.classifyConversationLengthLimitText("You've reached the maximum length for this conversation. You can start a new chat to continue.");
  assert.equal(en?.locale, 'en');
  assert.equal(budget.classifyConversationLengthLimitText('我们正在讨论对话长度上限这个概念。'), null);
});

test('hard-limit learning records a reliable upper bound but refuses to convert DOM-only fallback into a fake token maximum', () => {
  const previous = budget.nextLearnedProfile({
    accountScope: 'acct-one', model: 'gpt-5.6-sol', confirmedConversationTokens: 100_000, baseSafeLimitTokens: 90_000,
  });
  const domOnly = budget.nextHardLimitProfile({
    previous, accountScope: 'acct-one', model: 'gpt-5.6-sol', observedConversationTokens: 112_000,
    measurementSource: 'dom-fallback', measurementReliable: false, conversationKey: 'conversation:one',
  });
  assert.equal(domOnly.hardLimitObserved, true);
  assert.equal(domOnly.hardLimitUpperBoundTokens || 0, 0);
  assert.equal(domOnly.hardLimitConfidence, 'ui-boundary-only');

  const measured = budget.nextHardLimitProfile({
    previous: domOnly, accountScope: 'acct-one', model: 'gpt-5.6-sol', observedConversationTokens: 128_000,
    measurementSource: 'conversation-tree+dom-reconcile', measurementReliable: true, conversationKey: 'conversation:one',
  });
  assert.equal(measured.hardLimitUpperBoundTokens, 128_000);
  assert.equal(measured.hardLimitConfidence, 'measured-upper-bound');

  const constrained = budget.computeBudget({
    historyTokens: 110_000, contextLimitTokens: 1_050_000, adaptiveSafeLimitTokens: 180_000,
    hardLimitUpperBoundTokens: measured.hardLimitUpperBoundTokens, confirmedLowerBoundTokens: measured.confirmedConversationTokens,
  });
  assert.equal(constrained.safeLimitTokens, 128_000);
  assert.equal(constrained.hardLimitActive, true);
});
'''
write(path, source)

path = 'extension/tests/license-routing.test.mjs'
source = read(path)
source = source.replace("test('legacy license listener is removed and account messages are handled by background'", "test('legacy license UI is removed while background keeps a stale-popup migration bridge'", 1)
source = replace_once(source, '''  assert.match(backgroundSource, /GPTLOCK_ACCOUNT_LOGIN/);
''', '''  assert.match(backgroundSource, /GPTLOCK_ACCOUNT_LOGIN/);
  assert.match(backgroundSource, /GPTLOCK-LICENSE-GET/);
  assert.match(backgroundSource, /LICENSE_UI_STALE/);
''', 'license bridge test')
write(path, source)

path = 'license-server/test/smoke.test.mjs'
source = read(path)
source = replace_once(source, '''    assert.match(adminHtml, /id="createUserPanel"/);
    assert.match(adminJs, /emailVerificationRequired/);
    assert.match(adminJs, /\\/admin\\/api\\/account\\/users/);
''', '''    assert.match(adminHtml, /id="createUserPanel"/);
    assert.match(adminHtml, /id="userPasswordDialog"/);
    assert.match(adminJs, /emailVerificationRequired/);
    assert.match(adminJs, /\\/admin\\/api\\/account\\/users/);
    assert.match(adminJs, /saveUserRow/);
    assert.doesNotMatch(adminJs, /\\bprompt\\(/);
''', 'admin UI smoke assertions')
source = replace_once(source, '''    assert.equal(weakManual.data.error.code, 'WEAK_PASSWORD');

    // Admin can also explicitly create a verification-exempt account even while global verification is enabled.
''', '''    assert.equal(weakManual.data.error.code, 'WEAK_PASSWORD');

    // Administrator can change an existing user's password; plaintext never returns and every old session is revoked.
    const adminChangedPassword = 'AdminChanged-24680';
    const passwordChange = await jsonRequest(`${base}/admin/api/account/users/${manualCreate.data.user.id}/password`, {
      method: 'POST', headers: { cookie }, body: { password: adminChangedPassword },
    });
    assert.equal(passwordChange.response.status, 200);
    assert.equal(passwordChange.data.sessionsRevoked, true);
    assert.equal(JSON.stringify(passwordChange.data).includes(adminChangedPassword), false);

    const oldManualSession = await jsonRequest(`${base}/api/v1/account/me`, {
      headers: { origin: ORIGIN, authorization: `Bearer ${manualLogin.data.sessionToken}` },
    });
    assert.equal(oldManualSession.response.status, 401);

    const oldManualPasswordLogin = await jsonRequest(`${base}/api/v1/auth/login`, {
      method: 'POST', headers: { origin: ORIGIN, 'x-forwarded-for': '203.0.113.16' },
      body: extensionBody({ email: manualEmail, password: manualPassword, deviceId: 'manual-device-old-12345678', browserInstanceId: 'manual-browser-old-12345678' }),
    });
    assert.equal(oldManualPasswordLogin.response.status, 401);

    const newManualPasswordLogin = await jsonRequest(`${base}/api/v1/auth/login`, {
      method: 'POST', headers: { origin: ORIGIN, 'x-forwarded-for': '203.0.113.17' },
      body: extensionBody({ email: manualEmail, password: adminChangedPassword, deviceId: 'manual-device-new-12345678', browserInstanceId: 'manual-browser-new-12345678' }),
    });
    assert.equal(newManualPasswordLogin.response.status, 200);

    const editedManualEmail = 'manual-edited@example.com';
    const editedExpiry = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString();
    const userEdit = await jsonRequest(`${base}/admin/api/account/users/${manualCreate.data.user.id}`, {
      method: 'PATCH', headers: { cookie }, body: {
        email: editedManualEmail, status: 'active', entitlementExpiresAt: editedExpiry,
        maxDevicesOverride: 5, maxWindowsOverride: 6,
      },
    });
    assert.equal(userEdit.response.status, 200);
    assert.equal(userEdit.data.user.email, editedManualEmail);
    assert.equal(userEdit.data.user.entitlement.limits.devices, 5);
    assert.equal(userEdit.data.user.entitlement.limits.windows, 6);

    // Admin can also explicitly create a verification-exempt account even while global verification is enabled.
''', 'admin password/edit smoke flow')
write(path, source)


# 6. Release as 0.5.11 so the fixed extension/installer is distributable.
for version_path in ['extension/manifest.json', 'extension/package.json', 'native-core/Cargo.toml', 'native-core/Cargo.lock']:
    value = read(version_path)
    value = value.replace('0.5.10', '0.5.11')
    write(version_path, value)

print('Applied GPTLock context/admin/license fixes and bumped v0.5.11')
