# 邮件通知

启用后，评论审核合并、索引发布成功时，GitHub Actions 使用 Resend 尝试发送一封通知：

- 直接评论文章：发送到博主邮箱。
- 回复评论：发送到被回复者的 GitHub 公开邮箱；未公开邮箱或回复自己时跳过。

邮件包含文章标题、作者、评论正文和网站评论链接。评论发送者无需额外填写邮箱。

## 1. 设置发件地址

在 [Resend](https://resend.com/domains) 添加并验证自己的发件域名，然后创建发送邮件使用的 API Key。发件地址可以填写 `comments@example.com` 或 `博客评论 <comments@example.com>`。

域名验证步骤见 [Resend 文档](https://resend.com/docs/dashboard/domains/introduction)。

## 2. 配置评论仓库

在评论仓库的 `main/config/settings.json` 中添加下面两个配置组，保留已有的文章策略和正文限制：

```json
{
  "site": {
    "url": "https://blog.example",
    "name": "我的博客"
  },
  "notifications": {
    "enabled": true,
    "from": "博客评论 <comments@example.com>",
    "notifyOwner": true,
    "notifyReplies": true
  }
}
```

| 选项 | 默认值 | 用途 |
| --- | --- | --- |
| `site.url` | 空 | 博客的基地址（HTTP 或 HTTPS）；子目录部署时包含子目录 |
| `site.name` | 空 | 邮件中显示的网站名称 |
| `notifications.enabled` | `false` | 启用邮件通知 |
| `notifications.from` | 空 | Resend 发件地址，启用时必填 |
| `notifications.notifyOwner` | `true` | 文章收到根评论时通知博主 |
| `notifications.notifyReplies` | `true` | 评论收到回复时通知原作者 |

启用通知时必须填写 `site.url` 和 `notifications.from`。配置提交后，可用 `npx 0721c doctor --repository OWNER/REPO` 检查公开配置。

## 3. 添加 Secrets

打开评论仓库 **Settings → Secrets and variables → Actions → New repository secret**：

| Secret | 值 |
| --- | --- |
| `RESEND_API_KEY` | Resend API Key |
| `COMMENTS_OWNER_EMAIL` | 博主收信邮箱，仅开启博主通知时需要 |

Secrets 由发布工作流读取。收件邮箱不写入评论记录或网站索引。

## 4. 设置网站链接

网站配置要投稿的评论仓库，例如 Nuxt Content 的配置：

```ts
export default defineNuxtConfig({
  modules: ['0721c/nuxt'],
  comments0721c: {
    repository: 'OWNER/REPO',
    siteUrl: 'https://blog.example',
  },
});
```

评论仓库中的 `site.url` 决定邮件链接的网站基地址。文章路径优先使用 `config/articles.json` 或投稿中的文章路径，缺省时使用文章 ID。

本地测试时，可将 `site.url` 设置为 `http://localhost:3000`。收件人打开邮件链接时，需要在自己的浏览器中能够访问该地址。

## 5. 检查实际通知

提交一条评论并合并审核 PR，在 **Actions → 0721c publish index** 查看这次 PR 合并触发的运行。日志会显示邮件已提交发送、跳过或失败。

Resend 接受请求后，可在其控制台检查邮件投递情况。索引发布成功不代表邮件一定投递成功；发送失败不影响评论展示。

通知只处理本次合并 PR。定时重建、推送分支或手动运行索引发布只更新索引。

邮件链接使用 `?comment=<评论 ID>`。插件加载文章评论后会展开目标所在的话题并定位到该评论。

### 常见发送错误

| 日志代码 | 检查项 |
| --- | --- |
| `GITHUB_HTTP_403` | 发布工作流的 `pull-requests: read` 和仓库文件读取权限 |
| `GITHUB_HTTP_404` | 日志中指出的 PR 或评论文件是否存在 |
| `GITHUB_NETWORK_ERROR` | Actions 到 GitHub API 的网络连接 |
| `RESEND_API_KEY_MISSING` | 是否添加 `RESEND_API_KEY` Secret |
| `COMMENTS_OWNER_EMAIL_MISSING` | 博主收信 Secret 是否存在且格式正确 |
| `RESEND_HTTP_401` / `RESEND_HTTP_403` | API Key 和发件域名是否正确 |
| `RESEND_HTTP_429` | 是否触及 Resend 发送限制 |
| `RESEND_RESULT_UNKNOWN` | 发送请求是否出现网络异常或超时 |

## 关闭通知

将 `notifications.enabled` 改为 `false`，提交到 `main`。只关闭某一种通知时，将 `notifyOwner` 或 `notifyReplies` 改为 `false`。
