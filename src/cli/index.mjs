#!/usr/bin/env node
import { readFile, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { packageVersion } from './assets.mjs';
import { CLIError, errorSummary, fail } from './errors.mjs';
import { parseJSON } from './model.mjs';
import { init } from './init.mjs';
import { doctor } from './doctor.mjs';
import { upgrade } from './upgrade.mjs';
import { formatResult, formatError } from './presentation.mjs';

export { init, doctor, upgrade, CLIError };

export const HELP = `0721c：评论仓库初始化、更新与检查

0721c init [DIRECTORY] [--directory DIRECTORY] [--dry-run]
           [--config SETTINGS.json] [--articles ARTICLES.json] [--locale zh-CN|en]
0721c doctor [--directory DIRECTORY] [--repository OWNER/REPO]
0721c upgrade [--directory DIRECTORY] [--dry-run | --apply]
0721c --version

init     在新目录中生成 main、comments、index 三个分支。
upgrade  默认预览文件差异；加 --apply 才会更新本地文件。
doctor   只读取公开仓库，检查分支、配置和评论数据。

默认显示文字结果。各命令可加 --json，输出供脚本读取的 JSON。
初始化和更新不自动上传；上传使用你自己的 Git。
`;

export function parseArgs(argv) {
  const options = {};
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') return { command: 'help', options };
  if (argv[0] === '--version' || argv[0] === '-v') {
    if (argv.length !== 1) fail('INVALID_ARGUMENT', '--version 必须单独使用。');
    return { command: 'version', options };
  }
  const command = argv[0];
  if (!['init', 'doctor', 'upgrade'].includes(command)) fail('INVALID_COMMAND', 'Expected init, doctor or upgrade; remote automatic configuration is not supported.');
  const flags = { '--json': ['json', 'boolean'], '--repository': ['repository', 'value'], '--directory': ['directory', 'value'], '--dry-run': ['dryRun', 'boolean'], '--apply': ['apply', 'boolean'], '--config': ['configPath', 'value'], '--articles': ['articlesPath', 'value'], '--locale': ['locale', 'value'] };
  const allowed = { init: ['directory', 'dryRun', 'configPath', 'articlesPath', 'locale', 'json'], doctor: ['directory', 'repository', 'json'], upgrade: ['directory', 'dryRun', 'apply', 'json'] };
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--help' || argv[i] === '-h') return { command: 'help', options: {} };
    if (command === 'init' && argv[i] === '--') {
      if (options.directory !== undefined || i !== argv.length - 2) fail('INVALID_ARGUMENT', '-- 后只能指定一个初始化目录。');
      options.directory = argv[++i];
      break;
    }
    if (command === 'init' && !argv[i].startsWith('-')) {
      if (options.directory !== undefined) fail('INVALID_ARGUMENT', '初始化目录不能重复指定。');
      options.directory = argv[i];
      continue;
    }
    const equal = argv[i].indexOf('=');
    const flag = equal === -1 ? argv[i] : argv[i].slice(0, equal);
    const spec = flags[flag];
    if (!spec || !allowed[command].includes(spec[0])) fail('INVALID_ARGUMENT', '当前命令不支持此参数。', { option: flag });
    const [name, type] = spec;
    if (Object.hasOwn(options, name)) fail('INVALID_ARGUMENT', '参数不能重复指定。', { option: flag });
    if (type === 'boolean') {
      if (equal !== -1) fail('INVALID_ARGUMENT', '此开关无需指定值。', { option: flag });
      options[name] = true;
    } else {
      const value = equal === -1 ? argv[++i] : argv[i].slice(equal + 1);
      if (!value || value.startsWith('--')) fail('INVALID_ARGUMENT', '此参数需要指定值。', { option: flag });
      options[name] = value;
    }
  }
  if (options.apply && options.dryRun) fail('INVALID_ARGUMENT', '--apply 与 --dry-run 不能同时使用。');
  if (options.locale && !['zh-CN', 'en'].includes(options.locale)) fail('INVALID_LOCALE', 'Supported locales are zh-CN and en.');
  return { command, options };
}

export async function runCLI(argv, dependencies = {}) {
  const write = dependencies.write ?? ((text) => process.stdout.write(`${text}\n`));
  const writeError = dependencies.writeError ?? ((text) => process.stderr.write(`${text}\n`));
  let jsonMode = false;
  try {
    const parsed = parseArgs(argv);
    jsonMode = parsed.options.json === true;
    if (parsed.command === 'help') { write(HELP); return 0; }
    if (parsed.command === 'version') { write(await packageVersion(dependencies.packageRoot)); return 0; }
    const options = { ...parsed.options };
    delete options.json;
    const injectable = parsed.command === 'doctor' ? ['packageRoot', 'fetchImpl', 'githubClient', 'execFileImpl'] : ['packageRoot'];
    for (const key of injectable) if (dependencies[key] !== undefined) options[key] = dependencies[key];
    if (options.configPath) {
      options.settings = parseJSON(await readFile(options.configPath, 'utf8'), 'settings configuration');
      delete options.configPath;
    }
    if (options.articlesPath) {
      options.articles = parseJSON(await readFile(options.articlesPath, 'utf8'), 'articles configuration');
      delete options.articlesPath;
    }
    if (parsed.command === 'upgrade') options.onPlan = async (plan) => {
      if (!jsonMode) for (const change of plan.changes) write(change.diff);
      if (dependencies.onPlan) await dependencies.onPlan(plan);
    };
    const output = await ({ init, doctor, upgrade }[parsed.command])(options);
    write(jsonMode ? JSON.stringify(output, null, 2) : formatResult(parsed.command, output));
    if (parsed.command === 'doctor') return output.ok ? 0 : 1;
    return 0;
  } catch (error) {
    const summary = errorSummary(error);
    const separator = argv.indexOf('--');
    if (argv.slice(0, separator === -1 ? undefined : separator).includes('--json')) jsonMode = true;
    writeError(jsonMode ? JSON.stringify(summary, null, 2) : formatError(summary));
    return 1;
  }
}

// Importing the CLI, even through a symlink or under tests, performs no command
// and reads no credentials. Realpath also supports npm's symlinked bin entry.
async function isDirectEntry() {
  if (!process.argv[1]) return false;
  try { return await realpath(resolve(process.argv[1])) === await realpath(fileURLToPath(import.meta.url)); }
  catch { return false; }
}
if (await isDirectEntry()) process.exitCode = await runCLI(process.argv.slice(2));
