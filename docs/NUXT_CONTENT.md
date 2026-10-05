# Nuxt Content 接入

本文假设网站已经使用 Nuxt Content 查询并渲染 Markdown，且已安装 0721c。
评论仓库的创建步骤见 [初始化与部署](INITIALIZATION.md)。

## 配置模块

将模块加入 `nuxt.config.ts`，填写评论仓库和网站公开地址：

```ts
export default defineNuxtConfig({
  modules: ['@nuxt/content', '0721c/nuxt'],
  comments0721c: {
    repository: 'OWNER/blog-comments',
    siteUrl: 'https://blog.example',
    locale: 'zh-CN',
    timeZone: 'Asia/Shanghai',
    content: {
      pathPrefixes: ['/article'],
      markdownOnly: true,
    },
  },
});
```

保留项目已有的其他模块；已注册 `@nuxt/content` 时无需重复添加。
`siteUrl` 用于生成投稿表单中的文章链接。如果项目配置了 `site.url`，插件也可从中取得网站地址。

## 挂载到公共文章模板

在渲染文章正文的公共页面或组件中添加：

```vue
<template>
  <ContentRenderer v-if="page" :value="page" />
  <ClientOnly>
    <ContentComments0721c :document="page" class="article-comments" />
  </ClientOnly>
</template>
```

`page` 是该页面查询到的 Content 文档。评论组件从它取得文章路径、标题和评论设置，并自行读取评论索引。
模块自动注册组件并引入样式。

## 配置项

以下选项写在 `comments0721c` 下，也可以写入 `runtimeConfig.public.comments0721c`。
同名选项同时存在时，公开运行时配置优先。

| 选项 | 默认值 | 作用 |
| --- | --- | --- |
| `repository` | 空字符串 | 评论仓库，填写 `OWNER/REPO` 或 GitHub HTTPS 仓库地址 |
| `enabled` | `true` | 控制整个网站的评论区显示 |
| `siteUrl` | 项目 `site.url`，否则空 | 文章公开链接的基地址；未设置时浏览器使用当前 origin |
| `locale` | `zh-CN` | 界面和投稿模板语言，可选 `zh-CN`、`en` |
| `messages` | 当前语言的内置文案 | 按键覆盖评论区文本 |
| `timeZone` | 访客浏览器时区 | 评论时间显示时区，例如 `Asia/Shanghai`、`UTC` |
| `cacheTtlMs` | `60000` | 评论读取缓存时间，单位毫秒 |
| `indexBaseUrl` | 仓库 `index` 分支的 raw 地址 | 自托管索引或镜像的基地址 |
| `content.pathPrefixes` | `[]` | 只在指定路径下显示评论；空数组表示所有路径 |
| `content.markdownOnly` | `true` | 文档提供 `extension` 时，只接受 `md` 或 `.md` |

例如 `pathPrefixes: ['/article']` 会匹配 `/article` 和 `/article/...`，而不会匹配 `/articles/...`。
“关于”等普通页面也使用 Markdown 时，用路径筛选将它们排除。

## 自定义提示文案

在网站配置中统一覆盖需要修改的文本：

```ts
export default defineNuxtConfig({
  modules: ['0721c/nuxt'],
  comments0721c: {
    repository: 'OWNER/blog-comments',
    messages: {
      error: '评论加载失败，请注意，评论系统需要确保当前网络环境能够连接 GitHub',
      stale: '刷新失败，请确保当前网络环境能够连接 GitHub',
      post: '前往 GitHub 发表评论',
    },
  },
});
```

配置一次即可应用到所有评论区。未填写的键使用当前 `locale` 的内置文案；`runtimeConfig.public.comments0721c.messages` 按键覆盖模块配置。所有值均为纯文本字符串，数量和用户名分别使用 `{count}`、`{login}` 占位符。

完整键列表见[自定义文案](INTERFACE_CONTRACT.md#自定义文案)。

## 时间显示

`timeZone` 接受 IANA 时区名称。设置为 `Asia/Shanghai` 时，所有访客看到的评论时间都按北京时间显示；设置为 `UTC` 时按 UTC 显示。省略或设为空字符串时使用访客浏览器的时区。

该选项只影响界面显示。评论记录和 `time` 元素的 `datetime` 属性保留 UTC 时间。悬浮提示会注明显示时区；支持夏令时的地区按评论创建时的日期换算。

## 文章 ID 与链接

默认使用文档 `path` 作为文章 ID；缺少 `path` 时使用 `stem`。首尾斜杠被去掉，URL 编码被解码。

```text
document.path: /article/essay/2026-09-28-hello
articleId:     article/essay/2026-09-28-hello
articleUrl:    https://blog.example/article/essay/2026-09-28-hello
```

标题取 `document.title`。文章 ID 决定读取哪个索引，因此改动文章路径会改变对应的评论区。
如果文章改地址但仍希望沿用原来的评论，可将 `commentId` 固定为原 ID。

## Front Matter

关闭某篇文章的评论区：

```yaml
---
title: 文章标题
comments: false
---
```

为文章指定固定 ID：

```yaml
---
title: 文章标题
commentId: article/essay/2026-09-28-hello
---
```

若 Content 集合使用自定义 schema，应将字段加入已有 schema，例如：

```ts
schema: z.object({
  comments: z.boolean().default(true),
  commentId: z.string().optional(),
}),
```

`z` 从 `@nuxt/content` 导入。将示例字段与已有字段合并，并确认查询结果包含它们。

`comments: false` 隐藏该页面的评论区。需要在仓库端停止接收投稿、但继续显示已有评论时，
使用 [文章策略](MAINTENANCE.md#关闭一篇文章的评论)。

## 调整样式

组件继承宿主字体，通过 CSS 自定义属性调整颜色和尺寸：

```css
.article-comments {
  --0721c-accent: var(--primary);
  --0721c-border: var(--secondary);
  --0721c-text: #333;
  --0721c-muted: #777;
  --0721c-radius: 0;
}
```

| 变量 | 用途 |
| --- | --- |
| `--0721c-accent` | 按钮、链接和强调色 |
| `--0721c-text` | 正文颜色 |
| `--0721c-muted` | 日期、计数、状态文字 |
| `--0721c-border` | 分隔线与按钮边框 |
| `--0721c-background` | 背景 |
| `--0721c-surface` | 悬浮背景 |
| `--0721c-error` | 错误文字 |
| `--0721c-focus` | 键盘焦点颜色 |
| `--0721c-radius` | 按钮圆角 |
| `--0721c-font` | 字体 |
| `--0721c-avatar-size` | 根评论头像大小 |
| `--0721c-reply-avatar-size` | 回复头像大小 |

将颜色变量映射到网站主题变量后，切换网站主题时评论区会随之更新。请为自定义主题同时设置正文、辅助文字和背景颜色。

## 检查接入

打开一篇文章，确认评论区显示，再点击“发表评论”，检查 GitHub 表单中的标题和文章链接。
如果评论区没有出现，先确认 `repository` 已配置、`enabled` 为 `true`、文档路径匹配 `pathPrefixes`，
并检查 `page` 是否传入了实际文档。读取或发布问题见 [维护与排障](MAINTENANCE.md)。


## 邮件通知与评论直达

邮件通知在评论仓库配置，步骤见[邮件通知](EMAIL_NOTIFICATIONS.md)。仓库的 `site.url` 用于生成邮件中的网站链接。

评论组件支持 `?comment=<评论 ID>`，加载后自动展开目标所属话题并定位。
