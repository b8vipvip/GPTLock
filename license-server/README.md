# GPTLock License Server

授权服务用于 `https://gptlock.mv3.cn`。Node.js 22.16+，无第三方 npm 依赖，数据使用 Node 内置 SQLite 持久化。

## 功能

- 管理员生成授权码；授权验证继续只使用 HMAC，完整授权码另以 `GPTLOCK_LICENSE_SECRET` 派生密钥进行 AES-256-GCM 加密保存，仅管理员登录后的单码读取接口可解密，用于授权列表“复制授权码”。升级前只保存 HMAC 的历史授权记录无法恢复原始授权码。
- 每个授权码可设置设备上限、同时活跃 GPTLock 浏览器窗口上限、生效时间和到期时间。
- 设备绑定按 GPTLock Native Core 提供的稳定 `deviceId` 统计。
- 窗口使用按心跳租约统计；默认 150 秒未续租自动释放。
- 可停用/恢复授权、修改限制与有效期、释放设备绑定。
- 客户端激活后使用随机 activation token，不在后续心跳重复传输授权码。
- 管理后台提供“版本更新”：从 GitHub 拉取最新代码，隔离测试、SQLite 在线备份、部署、systemd 重启、健康检查和失败回滚自动完成，并实时显示进度与日志。

## 宝塔部署

1. 安装 Node.js 22 LTS（至少 22.16；一键更新使用 Node SQLite online backup）。
2. 将仓库 clone 到生产目录；`license-server/` 必须位于该 Git checkout 内。
3. 复制 `.env.example` 的变量到生产环境。`GPTLOCK_LICENSE_ADMIN_PASSWORD` 使用独立强密码；`GPTLOCK_LICENSE_SECRET` 建议 `openssl rand -hex 32`。
4. 启动命令：`node server.mjs`，工作目录为 `license-server`，监听 `127.0.0.1:3188`。
5. 在 `gptlock.mv3.cn` 站点配置反向代理到 `http://127.0.0.1:3188`，并开启有效 HTTPS 证书。
6. 打开 `https://gptlock.mv3.cn/admin/` 登录并生成授权码。

## 一键版本更新

Web 服务本身以低权限用户运行，不直接获得 root 或任意 shell 权限。管理员点击“版本更新”后，服务只在数据目录写入一个更新请求；root 级 systemd path unit 监听该请求并启动固定的更新脚本。这避免了给 Web 进程开放 sudo。

首次启用需要在服务器上手工执行一次：

```bash
cd /path/to/GPTLock/license-server
sudo bash scripts/install-updater-systemd.sh
```

安装器会自动识别当前 Git 仓库、数据库数据目录、Node 22 和 `gptlock-license.service`，创建：

- `/etc/systemd/system/gptlock-license-update.path`
- `/etc/systemd/system/gptlock-license-update.service`

默认更新 `main`。可以在安装前通过环境变量覆盖：

```bash
GPTLOCK_UPDATE_REF=main \
GPTLOCK_UPDATE_NODE_BIN=/usr/local/bin/node22 \
sudo -E bash scripts/install-updater-systemd.sh
```

### GitHub 网络不稳定时的自适应传输

默认 `GPTLOCK_UPDATE_TRANSPORT=auto`。更新器不再固定依赖 `origin` 当前使用的协议，而是按以下顺序尝试受信任的 GPTLock 仓库：

1. 已配置且受信任的 SSH origin（如果当前 origin 本来就是 SSH）。
2. `git@github.com:b8vipvip/GPTLock.git`，GitHub SSH 22 端口。
3. `ssh://git@ssh.github.com:443/b8vipvip/GPTLock.git`，GitHub 官方 SSH-over-443。
4. 当前受信任的 HTTPS origin（如果存在）。
5. `https://github.com/b8vipvip/GPTLock.git`，强制 HTTP/1.1 作为最终兜底。

每条链路都有独立连接超时、整体 fetch 超时、失败重试和退避；SSH 使用 keepalive，HTTPS 使用 low-speed 检测，避免网络半断开时无限挂住。成功路线会写入 `update-status.json`、`deployment.json` 和 `update.log`，便于判断服务器实际走的是 `ssh-22`、`ssh-443` 还是 `https-http1`。

SSH 不使用 `StrictHostKeyChecking=no`。仓库自带 `scripts/github-known-hosts`，固定 GitHub 官方 Ed25519 host key，并同时覆盖 `github.com` 和 `[ssh.github.com]:443`。如果 GitHub 将来轮换 host key，SSH 路线会安全失败并在 `auto` 模式下继续回退 HTTPS，而不是静默接受未知主机。

服务器已经配置 GitHub SSH key 时通常无需额外配置。可手工验证：

```bash
ssh -T git@github.com
ssh -T -p 443 git@ssh.github.com
```

GitHub 的成功认证测试通常仍返回非零退出码，因为 GitHub 不提供 shell；看到 `successfully authenticated` 即说明密钥可用。

可选参数：

```bash
GPTLOCK_UPDATE_TRANSPORT=auto
GPTLOCK_UPDATE_FETCH_RETRIES=2
GPTLOCK_UPDATE_FETCH_TIMEOUT_SECONDS=60
GPTLOCK_UPDATE_SSH_CONNECT_TIMEOUT_SECONDS=12
GPTLOCK_UPDATE_SSH_KEEPALIVE_SECONDS=10
GPTLOCK_UPDATE_HTTPS_LOW_SPEED_TIME_SECONDS=30
GPTLOCK_UPDATE_HTTPS_LOW_SPEED_LIMIT_BYTES=1024
```

如果只允许 SSH，可设 `GPTLOCK_UPDATE_TRANSPORT=ssh`；如果服务器没有 SSH key，可设 `https`；`origin` 则恢复为只使用当前 origin 的单链路行为。

> SSH 适用于 Git clone/fetch/push，不是 GitHub Release 安装包的下载协议。Release 资产仍通过 HTTPS/CDN 下载。客户端安装包更新器会单独使用 HTTPS 重试、超时和 SHA-256 校验；服务端代码更新本身不需要下载 Release 安装包，因此优先 Git SSH 是最有效的优化。

每次服务端更新执行以下阶段：

1. 检查 Git、Node、systemd、curl、`timeout`、工作区以及受信任的 `b8vipvip/GPTLock` origin。
2. 使用自适应 SSH/HTTPS 链路获取最新提交。
3. 在临时 Git worktree 中运行语法检查和 `node --test`，不先污染生产代码。
4. 使用 Node `node:sqlite` online backup 备份当前 SQLite 数据库到 `update-backups/`。
5. 将生产 Git checkout 切换到已测试的目标提交。
6. 重启 `gptlock-license.service` 并轮询本机 `/api/v1/health`。
7. 健康检查失败时自动 `git reset --hard` 回滚到更新前提交并重启服务。

实时状态保存在数据库同目录的 `update-status.json`，日志保存在 `update.log`，成功部署信息保存在 `deployment.json`。后台每秒轮询这些状态，因此服务重启期间会短暂显示“等待重新连接”，恢复后继续显示同一个更新任务的最终结果。

> 第一次加入更新器功能本身仍需让生产服务器取得包含这些文件的提交。如果旧更新器的 HTTPS 不稳定，但服务器 SSH 已可用，可以先把生产 checkout 的受信任 `origin` 临时/永久改成 `git@github.com:b8vipvip/GPTLock.git`，再执行一次旧版更新器；升级到本版本后，后续管理后台更新会自动在 SSH 22、SSH 443 和 HTTPS 间切换。

不要把 `.env`、SQLite 数据库、更新日志、数据库备份或管理员密码提交到 Git。生产环境建议定期备份 `data/gptlock-license.sqlite3*`。
