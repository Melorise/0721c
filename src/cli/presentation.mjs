const changeNames = { add: '新增', modify: '修改', delete: '删除' };
const checkNames = {
  repository: '仓库可公开访问',
  'main-branch': 'main 分支', 'comments-branch': 'comments 分支', 'index-branch': 'index 分支',
  'main-files': '工作流和运行文件', configuration: '配置文件',
  'comments-json': '评论数据与文件路径', 'index-json': '文章索引与文件路径',
  'default-main': '默认分支为 main', 'issues-enabled': 'Issues 已启用',
};

const errorMessages = {
  INVALID_COMMAND: '命令不正确，请使用 init、doctor 或 upgrade。',
  INVALID_LOCALE: '语言仅支持 zh-CN 或 en。',
  INVALID_JSON: '文件不是有效的 JSON，请检查文件内容。',
  INVALID_REPOSITORY: '仓库地址不正确，请使用 owner/repo 或 GitHub SSH、HTTPS 地址。',
  REPOSITORY_REQUIRED: '未找到仓库地址，请用 --repository 指定，或在本地仓库设置 origin。',
  AMBIGUOUS_ORIGIN: '存在多个 origin 地址，请用 --repository 明确指定仓库。',
  DIRECTORY_NOT_EMPTY: '目标目录非空，请选择新目录。',
  FILES_DIFFER: '现有文件与模板不同，请使用 upgrade 预览更新。',
  CONFIGURATION_CONFLICT: '重复初始化不能修改配置，请直接编辑配置文件。',
  TARGET_CHANGED: '目标目录在初始化期间发生变化，请检查后重试。',
  UNSAFE_DIRECTORY: '目录或文件类型不符合要求，请使用普通 Git 仓库目录，避免符号链接或共享文件。',
  NESTED_REPOSITORY: '请将评论仓库放在其他 Git 工作目录之外。',
  UNSAFE_GIT_CONFIG: 'Git 配置包含不支持的重定向或共享设置，请检查仓库配置。',
  ROLLBACK_CONFLICT: '并发修改阻止了回滚，请检查相关文件后再继续。',
  INVALID_ARTICLES: '文章配置格式不正确，请检查 config/articles.json。',
  INVALID_DATA_FILE: '评论和索引分支只允许 JSON 数据文件及 README.md。',
  UNSUITABLE_REPOSITORY: '请选择正常启用的独立仓库，不能使用归档、禁用或 fork 仓库。',
  INVALID_CLIENT: '检查工具的请求接口不正确。',
  READ_ONLY_OPERATION: '仓库检查只允许读取数据。',
  UNSAFE_API_PATH: '请求地址不属于所选公开仓库。',
  INVALID_REMOTE: 'GitHub 返回的仓库数据格式不正确，请重试。',
  INVALID_REMOTE_PATH: '远端仓库包含不安全的文件路径。',
  TREE_TOO_LARGE: '仓库文件列表不完整，无法完成检查。',
  UNSAFE_REMOTE_FILE: '远端文件必须是普通文件。',
  INVALID_REMOTE_BLOB: '远端文件过大或编码不正确。',
  INCOMPLETE_PACKAGE: '插件包缺少必要文件，请重新安装。',
  UNSAFE_PACKAGE: '插件包包含不符合要求的文件，请重新安装。',
  INVALID_PACKAGE_VERSION: '插件包缺少版本号，请重新安装。',
  INVALID_DATE: '初始化时间不正确。',
  NOT_A_DEPLOYMENT: '此目录不是评论仓库，请选择已初始化的仓库并切换到 main 分支。',
  MAIN_CHECKOUT_REQUIRED: '请先切换到 main 分支再更新。',
  MISSING_DATA_BRANCH: '缺少 main、comments 或 index 分支。',
  CONCURRENT_CHANGE: '文件或分支在操作期间发生变化，请重新预览后再更新。',
  INITIALIZATION_LOCKED: '另一个初始化正在运行，请稍后重试。',
  PUBLIC_REPOSITORY_REQUIRED: '评论仓库必须是公开仓库。',
  MISSING_RUNTIME_FILE: '缺少工作流或运行文件，请检查 main 分支。',
  MISSING_CONFIGURATION: '缺少 config/settings.json，请检查 main 分支。',
  INVALID_DATA_PATH: '评论或索引文件的路径与内容不一致。',
  REMOTE_OR_IO_FAILURE: '操作失败，请检查路径、网络和仓库地址后重试。',
};

export function formatError(summary) {
  const reason = errorMessages[summary.code] ?? summary.message;
  const lines = [`操作失败：${reason}`];
  for (const key of ['path', 'directory', 'option']) {
    if (typeof summary.details?.[key] === 'string') {
      const label = { path: '文件', directory: '目录', option: '参数' }[key];
      lines.push(`${label}：${summary.details[key]}`);
    }
  }
  if (summary.status) lines.push(`HTTP 状态：${summary.status}`);
  if (['INVALID_COMMAND', 'INVALID_ARGUMENT'].includes(summary.code)) lines.push('使用 0721c --help 查看用法。');
  return lines.join('\n');
}

export function formatResult(command, output) {
  if (command === 'init') {
    const title = output.unchanged ? '目录已初始化，无需改动。' : output.dryRun ? '初始化预览（未写入文件）。' : '初始化完成。';
    const lines = [title, `目录：${output.directory}`, `版本：${output.version}`];
    if (output.unchanged) return lines.join('\n');
    lines.push(`${output.dryRun ? '将创建' : '已创建'}分支：main、comments、index`);
    if (output.dryRun) lines.push(`将生成 ${output.plan.files.length} 个文件。`, '去掉 --dry-run 即可初始化。');
    else lines.push('下一步：设置 origin，并上传 main、comments、index 三个分支。', '在 GitHub 设置 Actions 权限；具体步骤见仓库 README.md。');
    return lines.join('\n');
  }
  if (command === 'doctor') {
    const lines = [`检查仓库：${output.repository}`];
    for (const check of output.checks) {
      lines.push(`${check.ok ? '通过' : '未通过'}：${checkNames[check.code] ?? check.message}`);
      if (!check.ok && check.error) lines.push(`  ${formatError(check.error)}`);
    }
    lines.push(output.ok ? '检查通过。' : '检查未通过，请修复以上项目后重试。');
    return lines.join('\n');
  }
  const title = output.status === 'unchanged' ? '文件已是当前版本，无需更新。' : output.applied ? '本地文件更新完成。' : '更新预览（未修改文件）。';
  const lines = [title, `目录：${output.directory}`, `版本：${output.version}`];
  if (output.changes.length) {
    lines.push(`${output.applied ? '已更新' : '将更新'} ${output.changes.length} 个文件：`);
    for (const change of output.changes) lines.push(`  ${changeNames[change.kind]} ${change.path}`);
    lines.push(output.applied ? '下一步：检查 git diff，确认后自行提交并上传 main。' : '确认差异后，给原命令加 --apply 执行更新。');
  }
  return lines.join('\n');
}
