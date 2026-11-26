# 部署手册：MariaDB / MySQL 知识库

本插件把知识库放在两种地方：本机 SQLite（默认，零配置）和你自己的 MariaDB / MySQL（可选，用于多设备共享）。检索始终在本机副本上执行，云端只负责存数据与合并。

## 一、准备一台服务器

- 系统：Linux（Debian/Ubuntu 或任意发行版），1 核 1G 起。
- 端口：3306（建议只在防火墙放行到你的 IP，或改用私有网络）。
- 建议磁盘：知识条目是纯文本，附件默认不推云端，10G 足够长期使用。

## 二、用 Docker Compose 起一个 MariaDB

```yaml
# /srv/dsh-kb/docker-compose.yml
services:
  mariadb:
    image: mariadb:11
    restart: unless-stopped
    environment:
      MARIADB_ROOT_PASSWORD: "换成强密码"
    ports:
      - "3306:3306"
    volumes:
      - ./data:/var/lib/mysql
      - ./conf.d:/etc/mysql/conf.d
    command: >
      --character-set-server=utf8mb4
      --collation-server=utf8mb4_unicode_ci
      --innodb-buffer-pool-size=128M
```

```sh
mkdir -p /srv/dsh-kb/conf.d && cd /srv/dsh-kb && docker compose up -d
```

## 三、建账号与授权（插件侧只需填账号密码）

插件连接后会自动列出该账号可见的 database，并自动建本地副本；如果本地有新库而云端没有，会用当前账号尝试 `CREATE DATABASE`。因此账号需要：

```sql
-- 用 root 执行一次
CREATE USER 'dsh_kb'@'%' IDENTIFIED BY '换成强密码';
GRANT CREATE, GRANT OPTION ON *.* TO 'dsh_kb'@'%';
```

> 不想给 `CREATE`/`GRANT OPTION` 也可以：由管理员先建好库再 `GRANT ALL ON db名.* TO 'dsh_kb'@'%'`，插件只会同步已授权的库，不会尝试建库。

## 四、加密传输

- 插件高级设置里打开 TLS 后才会用加密连接；自签证书会接受（`rejectUnauthorized: false`），生产环境建议用受信任证书。
- 只在可信内网使用时可以关闭 TLS；关闭时敏感条目依然不会上传（见下）。

## 五、敏感内容

- 关键词命中（密码、token、密钥、账号、身份证、手机号等）→ 标为敏感，永不推送云端，云端不会留下占位符。
- 公司、经营、财务、合同、客户等命中 → 标为疑似，默认也不推送，进「疑似记录」等你批量归类。
- 敏感与疑似条目在本机仍可搜索、仍可被每轮检索注入，只是不出本机。

## 六、多设备

同一账号在多台机器上连接同一个库即可：各机器保有自己的本地副本，云端按 `updated_at` + 版本合并；两边都改同一条时新者留下、旧版进历史并标「有修改」，删掉新版会回退到旧版。

## 七、排障

| 现象 | 处理 |
|---|---|
| 连接被拒 | 检查端口、防火墙与 `bind-address`；Docker 部署时确认 3306 已映射 |
| 看不到库 | 确认账号有对应 database 的权限：`SHOW GRANTS FOR 'dsh_kb'@'%'` |
| 建库失败 | 账号缺 `CREATE`，按第三节补授权，或让管理员建好后授权 |
| 同步一直失败 | 侧栏「同步与备份」看待推计数与错误；本地写入不受影响，恢复网络后自动补推 |
| 中文搜索搜不到 | 本机索引正在重建或关键词不足 3 字；短语不足 3 字会退化为子串匹配 |

## 八、不用 Docker：systemd 直接跑 MariaDB

```sh
# Debian / Ubuntu
apt install -y mariadb-server
systemctl enable --now mariadb
mysql_secure_installation
```

`/etc/mysql/mariadb.conf.d/99-dsh-kb.cnf`：

```ini
[mysqld]
character-set-server=utf8mb4
collation-server=utf8mb4_unicode_ci
bind-address=0.0.0.0
```

```sh
systemctl restart mariadb
```
