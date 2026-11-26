# dsh-knowledge-manager

DSH（DeepSeek Harness）知识管理插件：SQLite 本地知识库（默认）＋ 可选 MariaDB/MySQL 外部库。

- 作者主页：https://space.bilibili.com/41158746
- License：MIT

## 安装

```bash
dsh plugin --profile web add github:MEMUZE80020/dsh-knowledge-manager
# 或在 DSH 插件管理里添加插件，填 github:MEMUZE80020/dsh-knowledge-manager
```

- GitHub：https://github.com/MEMUZE80020/dsh-knowledge-manager

安装后重启 DSH，侧栏出现「知识管理」，并注册 `kb_search` / `kb_record` / `kb_catalog` / `kb_create_library` / `kb_create_table` 工具与知识库提示词。

## 功能

- 多库与主题表、FTS5 trigram 中文子串检索
- 对话轮次知识卡片：新增 / 更新（修订）/ 引用，状态按写入时快照显示
- 疑似/敏感分类、批量操作、分页（每页 10 条）与跳转闪烁定位
- 启动备份、本地即时推送、云端轮询、手动同步（含“无需同步”反馈）
- 设置页全局配置，一键清除全部数据（10 秒二次确认）
- 敏感条目推送云端时按删除（tombstone）处理
- 版本号后「更新」徽章；更新检查与自动更新走 GitHub Releases（内置国内加速通道）
- 更新下载完成后顶部显示醒目提示，需重启 DSH 生效

## 数据位置

`~/.dsh/knowledge/`（`meta.db` 与 `libraries/*.db`），不随包上传。

## 隐私

插件只访问 npm registry（`registry.npmjs.org`）用于版本检查与更新；不包含任何私有服务器地址。
