# 开发指南

## 准备开发环境

需要 Node.js 22 或更新版本和 Git。在源码仓库中安装依赖：

```sh
npm ci
```

实现使用 ESM `.mjs` 文件，公开接口附带 TypeScript 声明。

## 源码结构

| 目录 | 职责 |
| --- | --- |
| `src/core/` | ID 和记录校验、Issue 模板、评论树、索引客户端 |
| `src/vue/` | Vue 配置、评论组件、Markdown 渲染 |
| `src/content/` | 文档路径和 Front Matter 适配、Content 评论组件 |
| `src/nuxt/` | Nuxt 模块、组件和样式注册、运行时配置 |
| `src/cli/` | 初始化、更新、诊断和终端输出 |
| `src/automation/` | GitHub REST 调用、投稿转换、审核校验和索引发布 |
| `styles/` | 评论组件样式 |
| `schemas/` | JSON Schema |
| `templates/deployment/` | 评论仓库三个分支的初始文件 |
| `tests/` | 协议、工作流、CLI、适配器和组件测试 |
| `scripts/verify-pack.mjs` | 打包后的安装和消费检查 |

核心模块用于浏览器和 Node.js；框架功能通过独立入口导出。Vue 和 Nuxt 作为可选 peer dependencies，由使用对应适配器的项目安装。

## 公开入口

- `0721c`：核心客户端、协议工具和类型。
- `0721c/vue`：Vue 评论组件和全局配置。
- `0721c/content`：Content 文档身份解析。
- `0721c/nuxt-content`：Content Vue 适配器。
- `0721c/nuxt`：Nuxt 模块。
- `0721c/style.css`：组件样式。
- `0721c` 命令：本地 CLI。

新增公开 API 时，同步更新导出、声明文件、消费者测试及[接口参考](INTERFACE_CONTRACT.md)。

## 处理流程

### 前端

Content 适配器根据文档路径和评论配置生成文章 ID。Vue 组件调用核心客户端读取 `<文章 ID>.json`，并生成预填 GitHub Issue 链接。

Markdown 渲染位于 `src/vue/markdown.mjs`；修改渲染规则时，检查清理后的 HTML 以及组件加载失败时的展示。

### 投稿转换

`intake-comment.mjs` 解析 Issue，将作者、创建时间和正文保存到 `comment-<Issue 编号>` 候选分支。它创建目标为 `comments` 的 PR，校验实际 PR head，完成后关闭 Issue。

重试先查已有 PR 和候选分支，复用保存的记录。修改重试逻辑时，应覆盖“候选已保存、PR 尚未创建”“PR 已创建、Issue 尚未关闭”等中断位置。

`review-presentation.mjs` 负责 PR 标题、文章上下文和评论正文的展示。

### 审核校验

`validate-comment.mjs` 检查 PR 的实际提交：只新增一条 JSON 记录、路径和身份一致，并能与当前已审核记录组成合法评论树。结果写到该提交的 `0721c/comment-data` 状态。

工作流检出 `main` 的运行文件，通过 API 读取待审核数据。处理评论内容时，将其作为数据而非可执行代码。

### 索引发布

`build-index.mjs` 按文章分组，应用策略并构建树。`publish-index.mjs` 生成完整新快照，发布前检查源分支是否仍为读取时的提交，然后强制更新 `index`。

修改发布逻辑时，覆盖空仓库、删除文章目录、关闭投稿和生成期间源分支变化的情况。

## 修改数据格式

格式定义分别用于记录、索引、Issue 模板和仓库配置。修改某个字段时检查：

1. `src/core/shared.mjs` 和 `validation.mjs` 的运行时校验。
2. `src/core/index.d.ts` 的公开类型。
3. `schemas/` 中的对应 Schema。
4. 工作流与客户端的读写逻辑。
5. [数据格式](PROTOCOL.md)和测试样例。

路径身份同时用于 Git 文件路径和 JSON 内容，需一起调整解析与校验。

## 修改初始化模板

`src/cli/assets.mjs` 读取三个分支的模板，将 core 和 automation 文件复制到 `main/.0721c/runtime/`。配置放在 `main/config/`，工作流放在 `main/.github/workflows/`。

变更模板时检查 init 生成内容、upgrade 差异，以及安装包的文件清单。主分支 README 应指导部署仓库维护，两个数据分支 README 应说明各自数据的位置和用途。

## 检查与打包

```sh
npm test
npm run test:types
npm run pack:verify
```

测试覆盖数据和处理流程；类型检查覆盖公开声明；打包检查在临时项目中安装 tarball，检查导出、CLI 和部署文件。

生成供网站安装的包：

```sh
npm pack
```

安装包内容由 `package.json` 的 `files` 控制。新增文件或文档链接时，确认目标也包含在包中。
