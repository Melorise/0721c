# 维护与排障

## 审核评论

投稿转换成功后，Issue 会关闭，评论进入待审核 PR。Issue 关闭表示转换完成；评论在 PR 合并、索引发布之后才会显示。

打开以“评论：《文章标题》”命名的 PR：

1. 确认文章标题、路径和链接。
2. 阅读作者、评论正文；回复还应检查父评论上下文。
3. 确认 `0721c/comment-data` 状态通过，并在 **Files changed** 查看实际新增记录。
4. 接受评论时合并到 `comments`，拒绝时直接关闭 PR。
5. 合并后查看 `0721c publish index`，完成后在网站刷新评论区。

`0721c/comment-data` 检查数据是否合法，内容是否适合发表由维护者判断。可以为 `comments` 分支设置必需检查，并允许发布工作流强制更新 `index`。

## 修改和删除评论

在 GitHub 切到 `comments` 分支，按文章路径打开目录，找到目标记录。也可在本地拉取后处理：

```sh
git fetch origin
git switch comments
git pull --ff-only origin comments
```

修改 `body_markdown` 可更正正文；删除 JSON 文件可移除评论。提交并推送 `comments` 后，发布工作流会重新生成索引。

删除父评论时，选择一种处理方式：

- 连同它的全部后代回复一起删除。
- 保留回复，先把受影响回复的 `reply_to` 改为 `null` 或同篇文章中仍存在的父评论。

父评论缺失会使整个索引发布失败。删除前建议备份或通过 Git 提交保留可恢复的版本。

要清除一篇文章的全部评论，删除其对应目录，并检查 `main/config/articles.json` 中是否还需保留该文章的策略。停止后续投稿的方法见下一节。

## 关闭一篇文章的评论

### 隐藏网站评论区

在文章 Front Matter 中设置：

```yaml
comments: false
```

此设置控制网站显示。需要同时阻止新的 Issue 投稿时，还要配置评论仓库策略。

### 保留已有评论，停止接收投稿

在 `main/config/articles.json` 中加入或修改文章条目：

```json
{
  "schema_version": 1,
  "articles": {
    "article/essay/2026-09-28-hello": {
      "enabled": false
    }
  }
}
```

将示例条目合并到已有配置，提交到 `main`。发布完成后，索引保留已有评论，网站停止提供该文章的投稿和回复入口，工作流也会拒绝新投稿。

另一种方式是将文章 ID 加入 `config/settings.json` 的 `articlePolicy.disabledIds`。恢复时需解除所有禁用条件。

## 只开放指定文章

在 `config/settings.json` 中将文章策略改为：

```json
{
  "articlePolicy": {
    "mode": "allowlist",
    "disabledIds": []
  }
}
```

在 `config/articles.json` 中为允许投稿的文章配置 `enabled: true`。其他文章的新投稿会被拒绝。完整配置格式见[数据格式](PROTOCOL.md#配置文件)。

## 更新插件

网站使用的包和评论仓库的运行文件需要分别更新。

1. 在网站项目安装新版本的包。
2. 在本地评论仓库切换到 `main` 并更新远程数据。
3. 从安装了新包的项目目录运行：

```sh
pnpm exec 0721c upgrade --directory /path/to/blog-comments
pnpm exec 0721c upgrade --directory /path/to/blog-comments --apply
```

4. 在评论仓库检查并提交变更：

```sh
git diff
git status --short
git add README.md .github .0721c/runtime
git commit -m "Update 0721c runtime"
git push origin main
```

更新保留 `config/` 配置和数据分支。工作流、运行文件及主分支 README 会按安装包更新，已有定制内容应在差异中检查。

本地操作需要普通的完整 Git 仓库，且拥有 `main`、`comments`、`index` 三个本地分支。新克隆仓库缺少数据分支时，可先创建：

```sh
git branch comments origin/comments
git branch index origin/index
```

仅为尚不存在的本地分支执行这些命令。

## 手动运行工作流

在 GitHub **Actions** 中选择工作流，点击 **Run workflow**，分支选 `main`：

| 工作流 | 输入 | 用途 |
| --- | --- | --- |
| `0721c intake comment` | `issue_number` | 转换或重试指定 Issue |
| `0721c validate comment` | `pr_number` | 检查指定审核 PR 的当前提交 |
| `0721c publish index` | 无 | 根据当前记录和配置重建全部索引 |

发布会在合并评论 PR、推送 `main` 或 `comments` 时触发，也有定时任务补发。手动发布适合处理漏触发或修复后的重建。

## 常见问题

### 提交 Issue 后没有审核 PR

检查 **Actions → 0721c intake comment**：

- 没有运行：确认默认分支是 `main`、Issues 和 Actions 已启用，工作流文件已上传。
- 模板错误：确认 Issue 第一行保留 `0721c-meta`，且模板下方有正文。
- 权限错误：按[初始化与部署](INITIALIZATION.md#4-设置-actions)检查 PR 创建权限和 Token。
- 数据错误：检查文章投稿策略、正文限制，以及回复的父评论是否已审核通过。

修正后，从 `main` 手动运行 intake 并填写 Issue 编号。尚未保存候选记录时会读取当前 Issue；已经生成 `comment-<Issue 编号>` 分支时会复用保存的评论。要更换已经保存的正文，可关闭原 PR 并重新投稿。

### PR 检查没有通过

查看检查对应的工作流。确认 PR 只新增一条评论 JSON，文件路径与记录 ID 一致，父评论存在，且文章仍允许投稿。

如果检查期间另一个 PR 合并或配置发生变化，可在 `main` 手动运行 validate，填写当前 PR 编号重新检查。

### 合并后网站仍未显示

按顺序检查：

1. PR 的目标分支是否为 `comments`，且已经合并。
2. `publish-index` 是否成功；失败时先检查记录或分支更新权限。
3. `index` 中是否存在 `<文章 ID>.json`，且包含该评论。
4. 网站配置的仓库和文章 ID 是否一致。
5. 点击评论区刷新，读取最新发布提交中的索引。

手动刷新以 `index` 已发布的数据为准；PR 尚未合并或发布工作流尚未完成时，新评论还未进入网站索引。

文章改过 URL 时，检查是否需使用 `commentId` 沿用原评论，见[Nuxt Content 接入](NUXT_CONTENT.md#文章-id-与链接)。

### 索引发布失败

发布会校验所有已审核记录。最近删除的父评论、重复 ID、错误 JSON 或过严的正文限制，都可能阻止发布。按日志中的文件路径修复 `comments` 或 `main` 配置，再运行 publish。

若日志包含 `STALE_INDEX_SNAPSHOT`，说明生成过程中源分支发生了变化；等待下一次任务，或手动重新发布。

### 仓库检查

从安装了包的项目运行：

```sh
pnpm exec 0721c doctor --repository OWNER/blog-comments
```

也可用 `--directory /path/to/blog-comments` 从本地 origin 确定要检查的远程仓库。结果检查公开分支、文件和 JSON 格式。Actions 设置、Secrets 和分支保护需要在 GitHub 页面核对。

## 邮件通知

配置和投递检查见[邮件通知](EMAIL_NOTIFICATIONS.md)。更新插件时，网站依赖和评论仓库工作流都需更新。
