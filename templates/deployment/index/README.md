# 文章评论索引

本分支供网站读取，每篇文章对应一个文件：

```text
<文章 ID>.json

article/essay/hello.json
```

JSON 包含文章 ID、评论总数、根评论数、投稿开关和嵌套评论树。网站根据当前文章 ID 请求对应文件。

## 更新

`0721c publish index` 根据 `comments` 中的记录和 `main` 中的配置重建整个分支，替换旧索引快照。

要修改评论，编辑 `comments` 分支的源记录；要调整投稿规则，编辑 `main/config/`。需要手动重建时，在 GitHub Actions 中选择 `0721c publish index`，从 `main` 运行。
