# GPTLock License Server

授权服务用于 `https://gptlock.mv3.cn`。Node.js 22.16+，无第三方 npm 依赖，数据使用 Node 内置 SQLite 持久化。

## 功能

- 管理员生成授权码；授权码明文只在创建时返回一次，数据库只保存 HMAC。
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

默认更新 `origin/main`。可以在安装前通过环境变量覆盖：

```bash
GPTLOCK_UPDATE_REF=main \
GPTLOCK_UPDATE_NODE_BIN=/usr/local/bin/node22 \
sudo -E bash scripts/install-updater-systemd.sh
```

每次更新执行以下阶段：

1. 检查 Git、Node、systemd、curl、工作区和受信任的 `github.com/b8vipvip/GPTLock` origin。
2. `git fetch origin <ref>` 获取最新提交。
3. 在临时 Git worktree 中运行语法检查和 `node --test`，不先污染生产代码。
4. 使用 Node `node:sqlite` online backup 备份当前 SQLite 数据库到 `update-backups/`。
5. 将生产 Git checkout 切换到已测试的目标提交。
6. 重启 `gptlock-license.service` 并轮询本机 `/api/v1/health`。
7. 健康检查失败时自动 `git reset --hard` 回滚到更新前提交并重启服务。

实时状态保存在数据库同目录的 `update-status.json`，日志保存在 `update.log`，成功部署信息保存在 `deployment.json`。后台每秒轮询这些状态，因此服务重启期间会短暂显示“等待重新连接”，恢复后继续显示同一个更新任务的最终结果。

> 第一次加入更新器功能本身仍需手工 `git pull`/切换到包含这些文件的提交并运行安装脚本。完成这次 bootstrap 后，以后的服务端代码更新都可以从管理后台一键完成。

不要把 `.env`、SQLite 数据库、更新日志、数据库备份或管理员密码提交到 Git。生产环境建议定期备份 `data/gptlock-license.sqlite3*`。
