# 初始化与部署

部署分为两部分：评论仓库负责收集、审核和保存评论，网站负责显示评论并提供投稿入口。
下面先创建评论仓库，再接入网站。

## 1. 安装

准备 Node.js 22 或更新版本及 Git。在网站项目中安装：

```sh
npm install 0721c
```

使用 pnpm 的项目执行：

```sh
pnpm add 0721c
```

只需初始化或维护评论仓库时，可以直接运行 npx，无需先安装网站依赖：

```sh
npx 0721c --help
```

下文使用 `npx 0721c`。已经安装依赖的 pnpm 项目也可使用 `pnpm exec 0721c`。

## 2. 生成本地仓库

选择网站工作目录之外的新目录，确保其上级目录已存在。先预览，再初始化：

```sh
npx 0721c init ../blog-comments --dry-run
npx 0721c init ../blog-comments
```

目标可以是新目录、空目录或尚无提交的空 Git 仓库，上级目录需已存在。初始化后默认位于 `main` 分支：

| 分支 | 初始内容 |
| --- | --- |
| `main` | `config/`、`.github/`、`.0721c/runtime/`、`README.md` |
| `comments` | `README.md`；后续保存已审核评论 |
| `index` | `README.md`；后续生成文章评论树 |

已有评论仓库的运行文件更新见 [更新插件](MAINTENANCE.md#更新插件)。

## 3. 上传到 GitHub

在 GitHub 新建公开仓库，例如 `OWNER/blog-comments`。创建时留空 README、许可证和 `.gitignore`，然后上传本地三个分支：

```sh
cd ../blog-comments
git remote add origin git@github.com:OWNER/blog-comments.git
git push -u origin main
git push origin comments index
```

也可以将 origin 设置为 HTTPS 地址。如果本地已经设置 origin，检查 `git remote -v` 后直接推送。

在 GitHub 仓库设置中确认默认分支为 `main`，并开启 Issues。

## 4. 设置 Actions

进入评论仓库 **Settings → Actions → General**：

1. 允许运行仓库中的 GitHub Actions 工作流，并允许 `actions/checkout` 和 `actions/setup-node`。
2. 在 **Workflow permissions** 中启用 **Allow GitHub Actions to create and approve pull requests**，保存设置。

工作流各自声明所需的 Token 权限。评论 PR 合并前，应确认 `0721c/comment-data` 检查通过；
可以在 `comments` 的分支规则中将它设为必需检查。

`index` 的发布采用强制更新。为该分支设置保护规则时，需要允许发布工作流更新它。

### 需要自定义 Token 时

通常使用工作流自带的 `GITHUB_TOKEN`。如果仓库或组织策略限制它创建 PR，可配置 fine-grained personal access token：

1. 在 GitHub 的 **Developer settings → Personal access tokens → Fine-grained tokens** 创建 Token。
2. 仓库范围选为评论仓库，设置以下仓库权限为 **Read and write**：`Contents`、`Issues`、`Pull requests`、`Commit statuses`。
3. 在评论仓库 **Settings → Secrets and variables → Actions** 中新增 Repository secret，名称为 `COMMENTS_TOKEN`，值为该 Token。

投稿工作流会优先使用 `COMMENTS_TOKEN`。Token 过期时需在同一位置替换。

## 5. 接入网站

在网站配置中填写评论仓库 `OWNER/blog-comments`：

- [Nuxt Content 接入](NUXT_CONTENT.md)
- [Vue 和 JavaScript 接入](INTERFACE_CONTRACT.md)

评论内容通过公开仓库提供，网站访客可以直接读取。发表评论时需要使用 GitHub 账号提交 Issue。

## 6. 提交第一条评论

1. 打开网站上的一篇文章，点击“发表评论”。
2. 在 GitHub 预填表单的模板下方填写正文，提交 Issue。
3. 在评论仓库 **Actions** 查看 `0721c intake comment`。成功后 Issue 关闭，同时生成指向 `comments` 的审核 PR。
4. 打开 PR，检查文章、作者、正文，以及 `0721c/comment-data` 状态。确认后合并 PR。
5. 等待 `0721c publish index` 完成，回到网站点击刷新查看评论。

每一步失败时的处理方法见 [维护与排障](MAINTENANCE.md#常见问题)。

## 命令输出

CLI 默认显示文字结果。脚本需要 JSON 时，在命令中加 `--json`：

```sh
npx 0721c init ../blog-comments --dry-run --json
npx 0721c doctor --repository OWNER/blog-comments --json
```

初始化和更新成功时退出码为 `0`；命令失败或仓库检查未通过时为 `1`。
