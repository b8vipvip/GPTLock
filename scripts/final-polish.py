from pathlib import Path


def read(path):
    return Path(path).read_text(encoding='utf-8-sig')


def write(path, value):
    Path(path).write_text(value, encoding='utf-8', newline='\n')


def replace_once(source, old, new, label):
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected 1 anchor, got {count}')
    return source.replace(old, new, 1)


# A learned ChatGPT product cap should reserve against that cap, not against the
# larger published model window; otherwise a 128k observed cap would reserve 42k.
path = 'extension/context-budget.js'
source = read(path)
source = replace_once(
    source,
    '    const reserveBasis = Math.max(nominalLimit, safeLimitTokens);\n',
    '    const reserveBasis = hardLimitUsable ? safeLimitTokens : Math.max(nominalLimit, safeLimitTokens);\n',
    'hard-limit reserve basis',
)
write(path, source)

# Make admin user+membership edits atomic. Validation is completed first, then
# membership expiry, user fields and session revocation commit together.
path = 'license-server/account-system.mjs'
source = read(path)
old = '''      if (userMatch && req.method === 'PATCH') {
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
'''
new = '''      if (userMatch && req.method === 'PATCH') {
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
        let updateMembershipExpiry = false;
        if (Object.prototype.hasOwnProperty.call(input, 'entitlementExpiresAt')) {
          if (membership) {
            const parsed = parseIso(input.entitlementExpiresAt);
            if (!parsed) fail(400, 'INVALID_ENTITLEMENT_EXPIRY', '会员有效期不能为空且必须是有效日期');
            if (Date.parse(parsed) <= Date.parse(membership.starts_at)) fail(400, 'INVALID_ENTITLEMENT_EXPIRY', '会员有效期必须晚于会员开始时间');
            membershipExpiresAt = parsed;
            updateMembershipExpiry = true;
          } else {
            freeExpiresAt = input.entitlementExpiresAt === null ? null : parseIso(input.entitlementExpiresAt);
            if (input.entitlementExpiresAt !== null && !freeExpiresAt) fail(400, 'INVALID_ENTITLEMENT_EXPIRY', '免费权益有效期格式无效');
          }
        }
        const maxDevicesOverride = input.maxDevicesOverride === null ? null : clampInt(input.maxDevicesOverride, 1, 1000, user.max_devices_override ?? 1);
        const maxWindowsOverride = input.maxWindowsOverride === null ? null : clampInt(input.maxWindowsOverride, 1, 1000, user.max_windows_override ?? 1);
        const changedAt = nowIso();
        db.exec('BEGIN IMMEDIATE');
        try {
          if (updateMembershipExpiry) {
            db.prepare('UPDATE memberships SET expires_at=? WHERE id=?').run(membershipExpiresAt, membership.id);
          }
          db.prepare(`UPDATE users SET email=?,status=?,free_expires_at=?,max_devices_override=?,max_windows_override=?,updated_at=? WHERE id=?`)
            .run(email, status, freeExpiresAt, maxDevicesOverride, maxWindowsOverride, changedAt, user.id);
          if (status === 'disabled') {
            db.prepare('DELETE FROM user_window_leases WHERE session_id IN (SELECT id FROM user_sessions WHERE user_id=?)').run(user.id);
            db.prepare('UPDATE user_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL').run(changedAt, user.id);
          }
          db.exec('COMMIT');
        } catch (error) {
          try { db.exec('ROLLBACK'); } catch {}
          throw error;
        }
        audit('admin_user_updated', user.id, {
          emailChanged: email !== user.email, status, freeExpiresAt, membershipId: membership?.id || null,
          membershipExpiresAt, maxDevicesOverride, maxWindowsOverride,
        });
        return json(res, 200, { ok: true, user: adminUserRow(userById(user.id)) }), true;
      }
'''
source = replace_once(source, old, new, 'atomic admin user patch')
write(path, source)

# The users table depends on plansCache. Load plans first so the first render never
# races to an empty membership selector.
path = 'license-server/public/admin.js'
source = read(path)
source = replace_once(
    source,
    '''    el.login.hidden = true; el.app.hidden = false; el.logout.hidden = false;
    await Promise.all([loadUsers(), loadPlans(), loadOrders(), loadSettings(), loadRuntimeLogs(), loadAudit(), loadUpdate()]);
''',
    '''    el.login.hidden = true; el.app.hidden = false; el.logout.hidden = false;
    await loadPlans();
    await Promise.all([loadUsers(), loadOrders(), loadSettings(), loadRuntimeLogs(), loadAudit(), loadUpdate()]);
''',
    'plans before users',
)
write(path, source)

# Regression: a learned 128k product cap should not reserve 4% of the unrelated
# 1.05M published model window.
path = 'extension/tests/context-budget.test.mjs'
source = read(path)
source = replace_once(
    source,
    '''  assert.equal(constrained.safeLimitTokens, 128_000);
  assert.equal(constrained.hardLimitActive, true);
''',
    '''  assert.equal(constrained.safeLimitTokens, 128_000);
  assert.equal(constrained.reserveTokens, 8_192);
  assert.equal(constrained.hardLimitActive, true);
''',
    'hard cap reserve regression',
)
write(path, source)

print('Applied final GPTLock transactional/context/admin polish')
