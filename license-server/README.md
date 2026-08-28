# GPTLock License Server

授权服务用于 `https://gptlock.mv3.cn`。Node.js 22.13+，无第三方 npm 依赖，数据使用 Node 内置 SQLite 持久化。

## 功能

- 管理员生成授权码；授权码明文只在创建时返回一次，数据库只保存 HMAC。
- 每个授权码可设置设备上限、同时活跃 GPTLock 浏览器窗口上限、生效时间和到期时间。
- 设备绑定按 GPTLock Native Core 提供的稳定 `deviceId` 统计。
- 窗口使用按心跳租约统计；默认 150 秒未续租自动释放。
- 可停用/恢复授权、修改限制与有效期、释放设备绑定。
- 客户端激活后使用随机 activation token，不在后续心跳重复传输授权码。

## 宝塔部署

1. 安装 Node.js 22 LTS（至少 22.13）。
2. 将 `license-server/` 放到例如 `/www/wwwroot/gptlock-license`。
3. 复制 `.env.example` 的变量到宝塔 Node 项目环境变量。`GPTLOCK_LICENSE_ADMIN_PASSWORD` 使用独立强密码；`GPTLOCK_LICENSE_SECRET` 建议 `openssl rand -hex 32`。
4. 启动命令：`node server.mjs`，工作目录为 `license-server`，监听 `127.0.0.1:3188`。
5. 在 `gptlock.mv3.cn` 站点配置反向代理到 `http://127.0.0.1:3188`，并开启有效 HTTPS 证书。
6. 打开 `https://gptlock.mv3.cn/admin/` 登录并生成授权码。

不要把 `.env`、SQLite 数据库或管理员密码提交到 Git。生产环境建议定期备份 `data/gptlock-license.sqlite3*`。
