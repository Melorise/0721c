# 数据格式

本文供需要检查记录、编写适配器或生成索引的开发者使用。部署和日常维护分别见[初始化与部署](INITIALIZATION.md)和[维护与排障](MAINTENANCE.md)。

## 文章 ID 与文件路径

文章 ID 使用文章 URL 的完整路径，去掉首尾斜杠。例如：

```text
URL:        /article/essay/2026-09-28-hello
文章 ID:    article/essay/2026-09-28-hello
评论目录:   article/essay/2026-09-28-hello/
索引文件:   article/essay/2026-09-28-hello.json
```

每段路径以 Unicode 字母、数字、下划线或连字符开头，后续可包含这些字符和句点。总长度最多 512 个 Unicode 码点。路径段不能为空。

Content 适配器会解码 URL 路径中的百分号编码并规范为 NFC；例如中文文章路径会对应中文目录。调用核心接口时，应传入已规范化的文章 ID。

## 评论记录

记录保存于 `comments` 分支，每条评论一个文件，路径为 `<id>.json`。

评论 ID 由文章 ID 和 GitHub Issue 编号组成：

```text
<文章 ID>/comments-<Issue 编号>
```

例如：

```json
{
  "id": "article/essay/2026-09-28-hello/comments-37",
  "blog_id": "article/essay/2026-09-28-hello",
  "reply_to": null,
  "author": {
    "login": "example-user",
    "avatar_url": "https://avatars.githubusercontent.com/u/1"
  },
  "created_at": "2026-10-05T02:00:00Z",
  "body_markdown": "评论正文",
  "article": {
    "title": "文章标题",
    "url": "https://blog.example/article/essay/2026-09-28-hello"
  }
}
```

| 字段 | 必需 | 说明 |
| --- | --- | --- |
| `id` | 是 | 评论的完整 ID，与文件路径对应 |
| `blog_id` | 是 | 所属文章 ID |
| `reply_to` | 是 | 根评论为 `null`；回复为同篇文章中父评论的完整 ID |
| `author.login` | 是 | 投稿者的 GitHub 用户名 |
| `author.avatar_url` | 否 | 投稿者头像地址 |
| `created_at` | 是 | GitHub Issue 的创建时间，使用 UTC ISO 格式 |
| `body_markdown` | 是 | Markdown 正文 |
| `article` | 否 | 用于审核显示的文章信息；提供时必须包含 `title`，可附带 `url` |

投稿时，作者、创建时间和编号取自 GitHub Issue。例如 Issue #37 对应 `comments-37.json`；同一评论仓库中的 Issue 编号唯一。

修改正文时保留 ID、文章 ID 和创建时间。树构建要求父评论存在、各评论 ID 唯一，且回复链不形成循环。

## 文章索引

索引保存于 `index` 分支的 `<文章 ID>.json`：

```json
{
  "blog_id": "article/essay/2026-09-28-hello",
  "total_count": 1,
  "root_count": 1,
  "comments_enabled": true,
  "comments": [
    {
      "id": "article/essay/2026-09-28-hello/comments-37",
      "reply_to": null,
      "author": { "login": "example-user" },
      "created_at": "2026-10-05T02:00:00Z",
      "body_markdown": "评论正文",
      "children": []
    }
  ]
}
```

| 字段 | 说明 |
| --- | --- |
| `blog_id` | 所属文章 ID |
| `total_count` | 根评论和全部回复的总数 |
| `root_count` | 根评论数 |
| `comments_enabled` | 是否接受新评论和回复 |
| `comments` | 根评论数组；每个节点的 `children` 为回复数组 |

节点保留评论 ID、父评论 ID、作者、时间和正文。根评论和同级回复按创建时间升序排列，同一时间按 Issue 编号的数值升序排列。

客户端请求当前文章对应的文件。404 返回空评论结果；其他 HTTP、网络和格式错误交由调用方处理。客户端返回的结果为只读对象。

发布工作流根据完整的 `comments` 快照和 `main` 配置重建索引，以新的根提交强制更新 `index` 分支。文章索引的修改应通过源记录或配置完成，下一次发布会替换整个索引快照。

## Issue 投稿格式

投稿正文的第一行必须是完整的路由注释：

```text
<!-- 0721c-meta:{"blog_id":"article/essay/2026-09-28-hello","reply_to":null,"article":{"title":"文章标题","url":"https://blog.example/article/essay/2026-09-28-hello"}} -->
<!-- 0721c-instructions
请勿修改或删除上面的文章标识和本模板。
请在下方填写评论正文。
评论会在审核通过后显示在文章下方。
-->

这里填写评论正文。
```

`blog_id` 必填，`reply_to` 省略或为空时视为根评论，`article` 可选。解析器会移除开头的模板说明，保存其后的正文。

生成模板时使用 `buildCommentIssueUrl`；它会处理 JSON 和 URL 编码。重复路由键、非法 ID、空正文和超过限制的正文会使转换失败。

## 配置文件

### config/settings.json

```json
{
  "schema_version": 1,
  "articlePolicy": {
    "mode": "open",
    "disabledIds": []
  },
  "limits": {
    "bodyCodepoints": 8000,
    "bodyBytes": 32768,
    "maxReplyDepth": 64
  },
  "locale": "zh-CN"
}
```

| 配置 | 默认值 | 说明 |
| --- | --- | --- |
| `schema_version` | `1` | 配置格式版本 |
| `articlePolicy.mode` | `open` | `open` 接受各文章投稿；`allowlist` 只接受文章配置中列出的文章 |
| `articlePolicy.disabledIds` | `[]` | 停止接收投稿的文章 ID |
| `limits.bodyCodepoints` | `8000` | 正文 Unicode 码点上限，可设为 1–8000 |
| `limits.bodyBytes` | `32768` | 正文 UTF-8 字节上限，可设为 1–32768 |
| `limits.maxReplyDepth` | `64` | 回复深度上限，可设为 0–64；根评论深度为 0 |
| `locale` | `zh-CN` | 仓库语言配置，可选 `zh-CN`、`en` |
| `site.url` | 空字符串 | 邮件链接使用的网站 HTTP(S) 基地址 |
| `site.name` | 空字符串 | 邮件中的网站名称 |
| `notifications.enabled` | `false` | 启用 Resend 邮件通知 |
| `notifications.from` | 空字符串 | 发件地址，启用通知时必填 |
| `notifications.notifyOwner` | `true` | 根评论通知博主 |
| `notifications.notifyReplies` | `true` | 回复通知父评论作者 |

设置项可省略，校验器会补齐默认值。正文限制同时作用于投稿和已审核记录，降低上限前应检查现有评论。

启用通知时必须同时设置 `site.url` 和 `notifications.from`。接入步骤和 Secrets 见[邮件通知](EMAIL_NOTIFICATIONS.md)。

### config/articles.json

```json
{
  "schema_version": 1,
  "articles": {
    "article/essay/2026-09-28-hello": {
      "enabled": true,
      "title": "文章标题",
      "url": "https://blog.example/article/essay/2026-09-28-hello"
    }
  }
}
```

此文件可选。每个文章条目必须包含布尔值 `enabled`，`title` 和 HTTP(S) `url` 可选。配置了非空标题时，审核 PR 优先使用这里的文章信息。

一篇文章接受投稿，需要同时满足：

- 不在 `disabledIds` 中。
- 其文章配置没有设为 `enabled: false`。
- 策略为 `open`，或已列入 `articles`。

关闭投稿仍保留已有评论，并在索引中设置 `comments_enabled: false`。

## 格式校验

JSON Schema 位于包内的 `schemas/`。运行时校验还会检查路径与记录身份、时间、回复关系、排序和计数。编写自定义工具时应复用核心校验函数，接口见[接口参考](INTERFACE_CONTRACT.md)。
