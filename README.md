# 0721c

基于 GitHub Issue 投稿评论、PR 审核评论、Actions 自动生成评论索引的前端评论系统。

读者点击网站上的“发表评论”或“回复”，在 GitHub 中填写正文。提交后，工作流将评论转成审核 PR 并关闭 Issue；维护者合并 PR 后，评论显示在网站上。

## 开始使用

安装到网站项目：

```sh
npm install 0721c
```

直接初始化评论仓库：

```sh
npx 0721c init ./blog-comments
```

准备一个公开的 GitHub 评论仓库，以及要接入评论的网站。评论仓库与网站源码仓库分别管理。

1. [初始化评论仓库](docs/INITIALIZATION.md)：安装工具、生成分支、上传并设置 Actions。
2. 接入网站：[Nuxt Content](docs/NUXT_CONTENT.md) 或 [Vue / JavaScript](docs/INTERFACE_CONTRACT.md)。
3. 从网站提交一条评论，在评论仓库审核 PR，合并后查看网站上的评论。
4. 按需设置[邮件通知](docs/EMAIL_NOTIFICATIONS.md)，在文章收到评论或评论收到回复时发送提醒。

本地工具要求 Node.js 22 或更新版本、Git。Vue 组件要求 Vue 3.5，Nuxt 模块支持 Nuxt 3.17 至 4.x。
当前版本为 0.2.5，安装方式见初始化说明。

## Nuxt Content 接入示例

在 `nuxt.config.ts` 中指定评论仓库和文章路径：

```ts
export default defineNuxtConfig({
  modules: ['@nuxt/content', '0721c/nuxt'],
  comments0721c: {
    repository: 'OWNER/REPO',
    siteUrl: 'https://blog.example',
    content: { pathPrefixes: ['/article'] },
  },
});
```

在公共文章模板的正文后挂载组件，其中 `page` 是当前查询到的 Content 文档：

```vue
<ClientOnly>
  <ContentComments0721c :document="page" />
</ClientOnly>
```

组件从文档取得文章路径和标题。详细配置、Front Matter 和样式示例见 [Nuxt Content 接入](docs/NUXT_CONTENT.md)。

## 评论仓库

| 分支 | 用途 | 日常操作 |
| --- | --- | --- |
| `main` | 工作流、运行文件和配置 | 调整策略，更新运行文件 |
| `comments` | 已审核的评论记录 | 合并评论 PR，编辑或删除评论 |
| `index` | 前端读取的文章评论树 | 由工作流生成 |

例如文章 `/article/essay/2026-09-28-hello` 的数据保存在：

```text
comments 分支
article/essay/2026-09-28-hello/20261005T020000000Z-a1b2c3d4e5f6.json

index 分支
article/essay/2026-09-28-hello.json
```

评论 ID 由文章路径、UTC 时间戳和随机短串组成。网站读取 `index` 分支中当前文章的 JSON 文件。

## 文档

- [初始化与部署](docs/INITIALIZATION.md)：安装、上传、Actions 设置和首次使用。
- [Nuxt Content 接入](docs/NUXT_CONTENT.md)：配置、公共模板、文章筛选和样式。
- [接口参考](docs/INTERFACE_CONTRACT.md)：Vue 组件、JavaScript 客户端和 CLI。
- [邮件通知](docs/EMAIL_NOTIFICATIONS.md)：Resend 设置、发件地址、收件规则和通知排障。
- [维护与排障](docs/MAINTENANCE.md)：审核、删除、关闭评论、更新和故障定位。
- [数据格式](docs/PROTOCOL.md)：评论记录、回复树、投稿模板和配置文件。
- [开发指南](docs/IMPLEMENTATION.md)：源码结构、处理流程和修改方法。

