const $ = (id) => document.getElementById(id);
const el = {
  notLogged: $('notLogged'), app: $('app'), refresh: $('refresh'), email: $('email'), statusBadge: $('statusBadge'), tier: $('tier'), expiry: $('expiry'),
  deviceUsage: $('deviceUsage'), windowUsage: $('windowUsage'), freeExpiry: $('freeExpiry'), memberExpiry: $('memberExpiry'), plans: $('plans'), orderMessage: $('orderMessage'),
  passwordForm: $('passwordForm'), currentPassword: $('currentPassword'), newPassword: $('newPassword'), newPassword2: $('newPassword2'), passwordMessage: $('passwordMessage'),
};

let account = null;
let config = null;

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) return reject(new Error(error.message));
      if (!response?.ok) return reject(new Error(response?.error || '请求失败'));
      resolve(response.data);
    });
  });
}

function localDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}
function money(cents) { return `¥${(Number(cents || 0) / 100).toFixed(2)}`; }
function message(node, text, tone = '') { node.textContent = text || ''; node.className = `message ${tone}`.trim(); }

function renderPlans() {
  el.plans.textContent = '';
  const methods = Array.isArray(config?.paymentMethods) ? config.paymentMethods : [];
  for (const plan of config?.plans || []) {
    const card = document.createElement('article'); card.className = 'plan';
    const title = document.createElement('h3'); title.textContent = plan.name;
    const price = document.createElement('div'); price.className = 'price'; price.textContent = money(plan.priceCents);
    const small = document.createElement('small'); small.textContent = ` / ${plan.durationDays} 天`; price.append(small);
    const benefits = document.createElement('ul'); benefits.className = 'benefits';
    for (const item of plan.benefits || []) { const li = document.createElement('li'); li.textContent = item; benefits.append(li); }
    const limit = document.createElement('p'); limit.className = 'muted'; limit.textContent = `设备 ${plan.limits.devices} · 同时窗口 ${plan.limits.windows}`;
    const payRow = document.createElement('div'); payRow.className = 'pay-row';
    if (!methods.length) {
      const disabled = document.createElement('button'); disabled.disabled = true; disabled.textContent = '支付方式暂未配置'; payRow.append(disabled);
    } else {
      for (const method of methods) {
        const button = document.createElement('button'); button.className = 'primary'; button.textContent = `${method.name}开通`;
        button.addEventListener('click', () => void createOrder(plan, method, button));
        payRow.append(button);
      }
    }
    card.append(title, price, limit, benefits, payRow); el.plans.append(card);
  }
}

function renderAccount() {
  const authenticated = Boolean(account?.authenticated);
  el.notLogged.hidden = authenticated;
  el.app.hidden = !authenticated;
  if (!authenticated) return;
  const user = account.user || {};
  const entitlement = account.entitlement || {};
  el.email.textContent = user.email || '—';
  el.statusBadge.textContent = entitlement.active ? '权益有效' : '权益已到期';
  el.statusBadge.className = `badge ${entitlement.active ? 'good' : 'bad'}`;
  el.tier.textContent = account.membership?.name || (entitlement.source === 'free' ? '免费期 / Free' : '未开通会员');
  el.expiry.textContent = `权益有效期至 ${localDate(entitlement.expiresAt)}`;
  el.deviceUsage.textContent = `${entitlement.usage?.devices ?? 0} / ${entitlement.limits?.devices ?? 0}`;
  el.windowUsage.textContent = `${entitlement.usage?.windows ?? 0} / ${entitlement.limits?.windows ?? 0}`;
  el.freeExpiry.textContent = localDate(user.freeExpiresAt);
  el.memberExpiry.textContent = localDate(account.membership?.expiresAt);
  renderPlans();
}

async function load() {
  try {
    const [state, remoteConfig] = await Promise.all([
      sendMessage({ type: 'GPTLOCK_GET_STATE' }),
      sendMessage({ type: 'GPTLOCK_ACCOUNT_CONFIG' }),
    ]);
    account = state.account || { authenticated: false };
    config = remoteConfig;
    renderAccount();
  } catch (error) {
    message(el.orderMessage, error.message, 'bad');
  }
}

async function createOrder(plan, method, button) {
  const original = button.textContent;
  button.disabled = true; button.textContent = '创建订单…';
  try {
    const data = await sendMessage({ type: 'GPTLOCK_ACCOUNT_CREATE_ORDER', planCode: plan.code, paymentMethod: method.code });
    const order = data.order;
    message(el.orderMessage, `订单 #${order.id} 已创建，金额 ${money(order.amountCents)}。${data.instructions || ''}`, 'good');
    if (order.payUrl) await chrome.tabs.create({ url: order.payUrl });
    else message(el.orderMessage, `订单 #${order.id} 已创建，但管理员尚未配置该支付方式的 HTTPS 支付页面。`, 'bad');
  } catch (error) {
    message(el.orderMessage, `创建订单失败：${error.message}`, 'bad');
  } finally {
    button.disabled = false; button.textContent = original;
  }
}

el.passwordForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (el.newPassword.value !== el.newPassword2.value) { message(el.passwordMessage, '两次新密码不一致。', 'bad'); return; }
  message(el.passwordMessage, '正在修改密码…');
  void sendMessage({ type: 'GPTLOCK_ACCOUNT_CHANGE_PASSWORD', currentPassword: el.currentPassword.value, newPassword: el.newPassword.value })
    .then(() => {
      el.currentPassword.value = ''; el.newPassword.value = ''; el.newPassword2.value = '';
      message(el.passwordMessage, '密码已修改，其他登录会话已失效。', 'good');
    })
    .catch((error) => message(el.passwordMessage, `修改失败：${error.message}`, 'bad'));
});

el.refresh.addEventListener('click', () => void load());
void load();
