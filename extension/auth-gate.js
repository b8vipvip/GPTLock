const $ = (id) => document.getElementById(id);
const el = {
  authShell: $('authShell'), appShell: $('appShell'), authMessage: $('authMessage'),
  showLogin: $('showLogin'), showRegister: $('showRegister'), showForgot: $('showForgot'),
  loginForm: $('loginForm'), loginEmail: $('loginEmail'), loginPassword: $('loginPassword'),
  registerForm: $('registerForm'), registerEmail: $('registerEmail'), registerPassword: $('registerPassword'), registerPassword2: $('registerPassword2'),
  verifyForm: $('verifyForm'), verifyEmailText: $('verifyEmailText'), verifyCode: $('verifyCode'), resendVerification: $('resendVerification'),
  forgotForm: $('forgotForm'), forgotEmail: $('forgotEmail'),
  resetForm: $('resetForm'), resetEmailText: $('resetEmailText'), resetCode: $('resetCode'), resetPassword: $('resetPassword'),
  accountEmail: $('accountEmail'), accountTier: $('accountTier'), accountExpiry: $('accountExpiry'), accountUsage: $('accountUsage'),
  accountCenter: $('accountCenter'), accountLogout: $('accountLogout'), enabled: $('enabled'),
};

let verificationEmail = '';
let resetEmail = '';

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) return reject(new Error(error.message));
      if (!response?.ok) return reject(Object.assign(new Error(response?.error || '请求失败'), { code: response?.code }));
      resolve(response.data);
    });
  });
}

function localDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

function setMessage(text, tone = '') {
  el.authMessage.textContent = text || '';
  el.authMessage.className = `auth-message ${tone}`.trim();
}

function showPanel(name) {
  const map = {
    login: el.loginForm,
    register: el.registerForm,
    verify: el.verifyForm,
    forgot: el.forgotForm,
    reset: el.resetForm,
  };
  for (const panel of Object.values(map)) panel.hidden = true;
  map[name].hidden = false;
  el.showLogin.classList.toggle('active', name === 'login');
  el.showRegister.classList.toggle('active', name === 'register' || name === 'verify');
  el.showForgot.classList.toggle('active', name === 'forgot' || name === 'reset');
  setMessage('');
}

function renderAccount(account, windowAccess = true) {
  const authenticated = Boolean(account?.authenticated);
  el.authShell.hidden = authenticated;
  el.appShell.hidden = !authenticated;
  if (!authenticated) return;

  const user = account.user || {};
  const entitlement = account.entitlement || {};
  const membership = account.membership;
  const sourceName = membership?.name || (entitlement.source === 'free' ? '免费期 / Free' : '无有效权益');
  el.accountEmail.textContent = user.email || '—';
  el.accountTier.textContent = sourceName;
  el.accountExpiry.textContent = `有效期 ${localDate(entitlement.expiresAt)}`;
  const usage = entitlement.usage || {};
  const limits = entitlement.limits || {};
  el.accountUsage.textContent = `设备 ${usage.devices ?? 0}/${limits.devices ?? 0} · 窗口 ${usage.windows ?? 0}/${limits.windows ?? 0}`;
  if (el.enabled) {
    el.enabled.disabled = !entitlement.active || !windowAccess;
    if (!entitlement.active) el.enabled.title = '免费期或会员已到期，请在账户中心开通会员';
    else if (!windowAccess) el.enabled.title = '当前窗口超过账户同时窗口上限';
    else el.enabled.title = '启用或关闭 GPTLock';
  }
}

async function refreshGate() {
  try {
    const state = await sendMessage({ type: 'GPTLOCK_GET_STATE' });
    const account = state?.account || { authenticated: false };
    renderAccount(account, state?.accountWindowAllowed !== false);
    if (!account.authenticated) showPanel('login');
    return state;
  } catch (error) {
    el.authShell.hidden = false;
    el.appShell.hidden = true;
    showPanel('login');
    setMessage(`读取账户状态失败：${error.message}`, 'bad');
    return null;
  }
}

el.showLogin.addEventListener('click', () => showPanel('login'));
el.showRegister.addEventListener('click', () => showPanel('register'));
el.showForgot.addEventListener('click', () => showPanel('forgot'));

el.loginForm.addEventListener('submit', (event) => {
  event.preventDefault();
  setMessage('正在登录…');
  void sendMessage({ type: 'GPTLOCK_ACCOUNT_LOGIN', email: el.loginEmail.value.trim(), password: el.loginPassword.value })
    .then(async () => {
      el.loginPassword.value = '';
      setMessage('登录成功。', 'good');
      await refreshGate();
      window.dispatchEvent(new CustomEvent('gptlock-account-changed'));
    })
    .catch((error) => setMessage(`登录失败：${error.message}`, 'bad'));
});

el.registerForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (el.registerPassword.value !== el.registerPassword2.value) {
    setMessage('两次输入的密码不一致。', 'bad');
    return;
  }
  verificationEmail = el.registerEmail.value.trim();
  setMessage('正在创建账号并发送验证码…');
  void sendMessage({ type: 'GPTLOCK_ACCOUNT_REGISTER', email: verificationEmail, password: el.registerPassword.value })
    .then(() => {
      el.registerPassword.value = '';
      el.registerPassword2.value = '';
      el.verifyEmailText.textContent = `验证码已发送至 ${verificationEmail}`;
      showPanel('verify');
      setMessage('验证码已发送，请检查邮箱。', 'good');
    })
    .catch((error) => setMessage(`注册失败：${error.message}`, 'bad'));
});

el.verifyForm.addEventListener('submit', (event) => {
  event.preventDefault();
  setMessage('正在验证邮箱…');
  void sendMessage({ type: 'GPTLOCK_ACCOUNT_VERIFY_EMAIL', email: verificationEmail, code: el.verifyCode.value.trim() })
    .then(() => {
      el.verifyCode.value = '';
      el.loginEmail.value = verificationEmail;
      showPanel('login');
      setMessage('邮箱验证成功，请登录。', 'good');
    })
    .catch((error) => setMessage(`验证失败：${error.message}`, 'bad'));
});

el.resendVerification.addEventListener('click', () => {
  if (!verificationEmail) return;
  setMessage('正在重新发送验证码…');
  void sendMessage({ type: 'GPTLOCK_ACCOUNT_RESEND_VERIFICATION', email: verificationEmail })
    .then(() => setMessage('如果邮箱仍待验证，新的验证码已发送。', 'good'))
    .catch((error) => setMessage(`发送失败：${error.message}`, 'bad'));
});

el.forgotForm.addEventListener('submit', (event) => {
  event.preventDefault();
  resetEmail = el.forgotEmail.value.trim();
  setMessage('正在请求重置验证码…');
  void sendMessage({ type: 'GPTLOCK_ACCOUNT_FORGOT_PASSWORD', email: resetEmail })
    .then(() => {
      el.resetEmailText.textContent = `如果 ${resetEmail} 已注册，验证码已经发送。`;
      showPanel('reset');
      setMessage('请检查邮箱中的重置验证码。', 'good');
    })
    .catch((error) => setMessage(`请求失败：${error.message}`, 'bad'));
});

el.resetForm.addEventListener('submit', (event) => {
  event.preventDefault();
  setMessage('正在重置密码…');
  void sendMessage({ type: 'GPTLOCK_ACCOUNT_RESET_PASSWORD', email: resetEmail, code: el.resetCode.value.trim(), newPassword: el.resetPassword.value })
    .then(() => {
      el.resetCode.value = '';
      el.resetPassword.value = '';
      el.loginEmail.value = resetEmail;
      showPanel('login');
      setMessage('密码已重置，请使用新密码登录。', 'good');
    })
    .catch((error) => setMessage(`重置失败：${error.message}`, 'bad'));
});

el.accountCenter.addEventListener('click', () => {
  void chrome.tabs.create({ url: chrome.runtime.getURL('account.html') }).then(() => window.close());
});

el.accountLogout.addEventListener('click', () => {
  void sendMessage({ type: 'GPTLOCK_ACCOUNT_LOGOUT' })
    .then(async () => {
      await refreshGate();
      window.dispatchEvent(new CustomEvent('gptlock-account-changed'));
    })
    .catch((error) => setMessage(`退出失败：${error.message}`, 'bad'));
});

window.addEventListener('gptlock-account-refresh', () => void refreshGate());
void refreshGate();
