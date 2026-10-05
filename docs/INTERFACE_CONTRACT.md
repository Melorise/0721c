# 接口参考

Nuxt Content 网站可直接按[Nuxt Content 接入](NUXT_CONTENT.md)配置；本文用于普通 Vue 项目、自定义前端和命令行脚本。

## Vue 应用

需要 Vue 3.5 或更新的 Vue 3 版本。在应用入口设置仓库并引入样式：

```ts
import { createApp } from 'vue';
import { create0721c } from '0721c/vue';
import '0721c/style.css';
import App from './App.vue';

createApp(App)
  .use(create0721c({ repository: 'OWNER/blog-comments', locale: 'zh-CN', timeZone: 'Asia/Shanghai' }))
  .mount('#app');
```

在公共文章模板中传入该页面的文章信息：

```vue
<script setup>
import { Comments0721c } from '0721c/vue';
</script>

<template>
  <Comments0721c
    article-id="article/essay/2026-09-28-hello"
    article-title="文章标题"
    article-url="https://blog.example/article/essay/2026-09-28-hello"
  />
</template>
```

在动态页面中，把这些属性绑定到路由或文章数据。

### 全局配置

`create0721c(options)` 接受配置对象或返回配置的 getter。响应式配置变化会更新组件。

| 选项 | 默认值 | 作用 |
| --- | --- | --- |
| `repository` | 空字符串 | 评论仓库，`OWNER/REPO` 或 GitHub HTTPS 仓库地址 |
| `locale` | `zh-CN` | 界面和投稿模板语言，`zh-CN` 或 `en` |
| `timeZone` | 访客浏览器时区 | 评论时间的显示时区，例如 `Asia/Shanghai`；空字符串也使用浏览器时区 |
| `enabled` | `true` | 是否显示评论区 |
| `indexBaseUrl` | GitHub raw 的 `index` 分支 | 索引基地址 |
| `cacheTtlMs` | `60000` | 内存缓存时间，单位毫秒 |
| `fetchImpl` | `globalThis.fetch` | 自定义 Fetch 实现 |
| `siteUrl` | 未设置 | Content 适配器生成文章链接时使用的网站基地址 |

`Comments0721c` 使用 `articleUrl` 提供投稿链接中的文章地址。`siteUrl` 由 Content 文档适配器使用。

### 组件属性

| 属性 | 必需 | 作用 |
| --- | --- | --- |
| `articleId` | 是 | 当前文章 ID |
| `articleTitle` | 否 | 投稿表单中的文章标题 |
| `articleUrl` | 否 | 投稿表单中的文章公开链接，与标题一起使用 |
| `title` | 否 | 评论区标题，默认随语言显示“评论”或“Comments” |
| `repository` | 否 | 覆盖应用配置中的仓库 |
| `locale` | 否 | 覆盖语言 |
| `timeZone` | 否 | 覆盖全局显示时区 |
| `enabled` | 否 | 显示或隐藏此组件 |
| `indexBaseUrl` | 否 | 覆盖索引基地址 |
| `cacheTtlMs` | 否 | 覆盖缓存时间 |
| `fetchImpl` | 否 | 覆盖 Fetch 实现 |

显式属性优先于全局配置。组件默认显示 20 条根评论，回复随所属话题一起显示；“显示更多”展开后续话题。

时间显示使用配置的 IANA 时区，记录中的 UTC 时间保持不变。修改显示时区会立即更新界面，不会重新请求评论索引。

### 手动刷新

通过模板 ref 调用 `refresh()`：

```vue
<script setup>
import { ref } from 'vue';
import { Comments0721c } from '0721c/vue';

const comments = ref(null);
</script>

<template>
  <Comments0721c ref="comments" article-id="article/essay/hello" />
  <button @click="comments?.refresh()">重新加载评论</button>
</template>
```

组件自带刷新按钮；此接口用于宿主页面需要联动刷新的情况。

### 页脚插槽

`footer` 插槽提供 `articleId`、`status`、`busy`、`totalCount`、`rootCount`、`canComment`、`newIssueUrl`、`title` 和 `refresh`。

## Content 文档适配

普通 Vue 应用可安装文档适配器：

```ts
import { createContent0721c } from '0721c/nuxt-content';
import '0721c/style.css';

app.use(createContent0721c({
  repository: 'OWNER/blog-comments',
  siteUrl: 'https://blog.example',
  content: { pathPrefixes: ['/article'] },
}));
```

在页面中导入组件并传入文档：

```vue
<script setup>
import { ContentComments0721c } from '0721c/nuxt-content';
defineProps({ page: Object });
</script>

<template>
  <ContentComments0721c :document="page" />
</template>
```

文档字段、Front Matter 和筛选规则见[Nuxt Content 接入](NUXT_CONTENT.md)。

只需要解析文档身份时，可从 `0721c/content` 导入 `resolveContentArticle(document, options)`。返回 `{ articleId, identity }`；被筛选掉的文档返回 `null`，非法配置抛出异常。

## JavaScript 客户端

自定义 UI 使用 `0721c` 导出的客户端：

```js
import { createClient } from '0721c';

const client = createClient({ repository: 'OWNER/blog-comments' });
const articleId = 'article/essay/2026-09-28-hello';
const article = {
  title: '文章标题',
  url: 'https://blog.example/article/essay/2026-09-28-hello',
};

const result = await client.getComments(articleId);
const postUrl = client.getNewIssueUrl({ articleId, article });

if (result.comments.length > 0) {
  const replyUrl = client.getNewIssueUrl({
    articleId,
    article,
    replyTo: result.comments[0].id,
  });
}
```

### createClient(options)

| 选项 | 默认值 | 说明 |
| --- | --- | --- |
| `repository` | 必填 | `OWNER/REPO` 或 GitHub HTTPS 仓库地址 |
| `locale` | `zh-CN` | 投稿模板语言，`zh-CN` 或 `en` |
| `cacheTtlMs` | `60000` | 缓存时间，单位毫秒；`0` 禁用缓存命中 |
| `indexBaseUrl` | GitHub raw 的 `index` 分支地址 | 自定义索引基地址 |
| `fetchImpl` | `globalThis.fetch` | 标准 Fetch 接口 |

镜像或自托管索引时，`indexBaseUrl` 指向索引目录，例如 `https://comments.example/index/`。该目录应提供 `<articleId>.json` 并允许网站跨域读取。

### 客户端方法

| 方法 | 作用 |
| --- | --- |
| `getComments(articleId, { force?, signal? })` | 读取评论；`force: true` 读取最新已发布索引，`signal` 用于取消请求 |
| `getNewIssueUrl({ articleId, replyTo?, article? })` | 返回预填 GitHub Issue 地址 |
| `clearCache()` | 清空客户端缓存 |

`getComments` 返回：

```ts
{
  status: 'ready' | 'empty' | 'disabled';
  articleId: string;
  totalCount: number;
  rootCount: number;
  comments: TreeNode[];
  commentsEnabled: boolean;
  index: ArticleIndex | null;
}
```

手动刷新默认先读取 GitHub `index` 分支当前的提交，再按提交 SHA 读取文章索引，并禁用浏览器缓存。自定义 `indexBaseUrl` 使用带唯一查询参数的无缓存请求。

404 返回 `empty`；其他 HTTP、网络或格式错误拒绝 Promise。调用方应捕获错误并提供重试。返回结果只读，界面状态应单独保存。

### 数据工具

| 函数 | 用途 |
| --- | --- |
| `buildCommentIssueUrl(options)` | 生成投稿地址，参数包含 `repository`、`articleId` 和可选的 `replyTo`、`article`、`locale` |
| `parseIssueBody(body, limits?)` | 解析模板，返回 `metadata`、`body_markdown` 和可选的 `article` |
| `validateCommentRecord(value)` | 校验并规范评论记录 |
| `validateArticleIndex(value)` | 校验并规范文章索引 |
| `validateSettings(value?)` | 校验配置并补齐默认值 |
| `buildCommentPermalink(articleUrl, commentId)` | 生成定位到具体评论的网站链接 |
| `buildCommentTree(records, { maxReplyDepth? })` | 将同篇文章的记录组成评论树 |

校验失败抛出 `ProtocolError`；`code` 标识错误类别，`message` 描述原因。类型可从包中导入，数据结构见[数据格式](PROTOCOL.md)。

## CLI

直接使用 `npx 0721c` 执行命令；已安装依赖的 pnpm 项目也可使用 `pnpm exec 0721c`。下文省略执行器前缀。

### 初始化

```sh
0721c init DIRECTORY [--dry-run] [--locale zh-CN|en]
0721c init DIRECTORY --config SETTINGS.json --articles ARTICLES.json
```

生成 `main`、`comments` 和 `index` 分支，初始工作目录在 `main`。目标可为新目录、空目录或尚无提交的空 Git 仓库，上级目录须存在，且位于其他 Git 仓库之外。

`--dry-run` 预览结果；`--config` 和 `--articles` 指定初始配置。`--directory DIRECTORY` 等同于位置参数，目录名以 `-` 开头时可用 `init -- DIRECTORY`。

### 检查公开仓库

```sh
0721c doctor --repository OWNER/REPO
0721c doctor --directory /path/to/blog-comments
```

`--directory` 用于从本地 Git origin 确定要检查的远程仓库。检查结果涵盖公开仓库状态、三个分支、运行文件、配置和数据格式。

### 更新本地部署

```sh
0721c upgrade --directory /path/to/blog-comments
0721c upgrade --directory /path/to/blog-comments --apply
```

默认预览差异；`--apply` 更新本地 `main` 中的运行文件和模板。需要三个本地分支，当前分支为 `main`。完成后检查差异，提交并上传，见[更新插件](MAINTENANCE.md#更新插件)。

### 输出与退出码

各命令默认显示文字结果，加 `--json` 可供脚本读取。更新结果的 `changes[].diff` 包含差异文本。

初始化或更新成功退出码为 `0`，失败为 `1`；doctor 检查全部通过时为 `0`，存在失败项时为 `1`。`--help` 查看用法，`--version` 查看安装版本。
