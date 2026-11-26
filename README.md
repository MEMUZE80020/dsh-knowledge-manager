# dsh-knowledge-manager

DSH（DeepSeek Harness）知识管理插件：SQLite 本地知识库（默认）＋ 可选 MariaDB/MySQL 外部库。

## 安装（DSH）

在 DSH 的插件管理里安装 Bundle，安装规格填：

```
git+https://git.zr97.top/1024/dsh-knowledge-manager.git
```

安装后重启 DSH，侧栏出现「知识管理」，并注册 `kb_search` / `kb_record` / `kb_catalog` / `kb_create_library` / `kb_create_table` 工具与知识库提示词。

## 功能

- 多库与主题表、FTS5 trigram 中文子串检索
- 对话轮次知识卡片：新增 / 更新（修订）/ 引用，状态按写入时快照显示
- 疑似/敏感分类、批量操作、分页（每页 10 条）与跳转闪烁定位
- 启动备份、本地即时推送、云端轮询、手动同步（含“无需同步”反馈）
- 设置页全局配置，一键清除全部数据（10 秒二次确认）
- 敏感条目推送云端时按删除（tombstone）处理

## 数据位置

`~/.dsh/knowledge/`（`meta.db` 与 `libraries/*.db`），不随仓库提交。

## 开发

```bash
# 代码即插件包，无需构建
```
