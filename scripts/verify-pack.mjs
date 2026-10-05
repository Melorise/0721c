import assert from 'node:assert/strict';
import { readFile, mkdir, mkdtemp, writeFile, copyFile, rm, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
assert.equal(pkg.name, '0721c');
assert.notEqual(pkg.private, true);
assert.equal(pkg.publishConfig.access, 'public');
assert.deepEqual(Object.keys(pkg.bin), ['0721c']);
const scratch = await mkdtemp(join(tmpdir(), '0721c-pack-'));
const artifacts = join(scratch, 'artifacts');
const consumer = join(scratch, 'consumer');
await mkdir(artifacts); await mkdir(consumer);
await writeFile(join(scratch, 'npm-user.conf'), '');
await writeFile(join(scratch, 'npm-global.conf'), '');
// npm uses cached public dependencies offline, with credential configuration
// disabled. No ambient administrator tokens or auth helpers reach child processes.
const env = Object.fromEntries(['PATH', 'TMPDIR', 'LANG', 'LC_ALL', 'SYSTEMROOT'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
Object.assign(env, { HOME: scratch, NPM_CONFIG_CACHE: join(homedir(), '.npm'), NPM_CONFIG_USERCONFIG: join(scratch, 'npm-user.conf'), NPM_CONFIG_GLOBALCONFIG: join(scratch, 'npm-global.conf'), NPM_CONFIG_LOGS_DIR: join(scratch, 'npm-logs'), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' });
function run(command, args, cwd = consumer) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}
const install = (...packages) => run('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', ...packages]);
const git = (directory, ...args) => run('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-C', directory, ...args]);
let packed;
try {
  packed = JSON.parse(run('npm', ['pack', '--offline', '--json', '--ignore-scripts', '--pack-destination', artifacts], root))[0];
  assert.equal(packed.name, pkg.name);
  assert.equal(packed.version, pkg.version);
  assert.equal(packed.filename, '0721c-' + pkg.version + '.tgz');
  const paths = packed.files.map(file => file.path);
  assert.ok(!paths.some(path => /original|\.txt$/.test(path)), 'No temporary implementation backups');
  assert.ok(!paths.some(path => /^(tests|scripts|node_modules|\.git|\.env)(\/|$|\.)/.test(path)), 'No development files or credentials');
  assert.ok(!paths.some(path => /deployment\.json|manifest\.json|reservations\.(mjs|d\.ts)$|src\/cli\/(configure|context)\./.test(path)), 'No deployment metadata, reservation runtime or credential/configuration helpers');
  for (const path of ['src/core/index.mjs', 'src/core/index.d.ts', 'src/vue/index.mjs', 'src/vue/index.d.ts', 'src/cli/index.mjs', 'src/cli/index.d.mts', 'src/cli/init.mjs', 'src/cli/upgrade.mjs', 'src/cli/local-upgrade.mjs', 'src/cli/public-context.mjs', 'src/cli/repository.mjs', 'docs/INITIALIZATION.md', 'styles/index.css', 'src/content/vue.mjs', 'src/content/identity.mjs', 'src/nuxt/plugin.mjs', 'src/nuxt/index.mjs', 'templates/deployment/main/.github/ISSUE_TEMPLATE/config.yml', 'templates/deployment/main/.github/workflows/intake-comment.yml', 'templates/deployment/main/.github/workflows/validate-comment.yml', 'templates/deployment/main/.github/workflows/publish-index.yml', 'templates/deployment/comments/README.md', 'templates/deployment/index/README.md']) assert.ok(paths.includes(path), `Missing asset: ${path}`);
  for (const branch of ['comments', 'index']) assert.deepEqual(paths.filter(path => path.startsWith(`templates/deployment/${branch}/`)), [`templates/deployment/${branch}/README.md`]);
  const tarball = join(artifacts, packed.filename);
  await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  install(tarball);
  await assert.rejects(access(join(consumer, 'node_modules/vue')), { code: 'ENOENT' });
  await assert.rejects(access(join(consumer, 'node_modules/@nuxt/kit')), { code: 'ENOENT' });
  run(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict'; import * as core from '0721c';
    const articleId = 'article/essay/slug';
    const index = {blog_id:articleId,total_count:1,root_count:1,comments_enabled:true,comments:[{id:'article/essay/slug/20261005T000000000Z-abcdef123456',reply_to:null,author:{login:'user'},created_at:'2026-10-05T00:00:00Z',body_markdown:'Hello',children:[]}]};
    let requests = 0;
    const client = core.createClient({repository:'example-owner/site-comments',async fetchImpl(url,options){
      assert.equal(options.credentials,'omit'); requests++;
      if (url.startsWith('https://api.github.com/repos/example-owner/site-comments/git/ref/heads/index?')) {
        assert.equal(options.cache,'no-store');
        return Response.json({ref:'refs/heads/index',object:{type:'commit',sha:'a'.repeat(40)}});
      }
      assert.ok([ 'https://raw.githubusercontent.com/example-owner/site-comments/index/article/essay/slug.json', 'https://raw.githubusercontent.com/example-owner/site-comments/'+'a'.repeat(40)+'/article/essay/slug.json' ].includes(url));
      return new Response(JSON.stringify(index));
    }});
    assert.equal((await client.getComments(articleId)).comments[0].id,'article/essay/slug/20261005T000000000Z-abcdef123456'); assert.equal(requests,1);
    assert.equal((await client.getComments(articleId,{force:true})).totalCount,1); assert.equal(requests,3);
    assert.equal('getManifest' in client,false);
    for (const removed of ['validateIndexManifest','PROTOCOL_VERSION','LAYOUT_VERSION']) assert.equal(removed in core,false);
    assert.match(client.getNewIssueUrl({articleId}),/github.com/);
  `]);
  // Check local package/bin resolution and argument forwarding through npx.
  assert.equal(run('npx', ['--offline', '--yes=false', '0721c', '--version']).trim(), pkg.version);
  // Outside an installed project, exercise the same bin inference using the tarball.
  const npxTarget = join(scratch, 'npx-comments');
  const npxPlan = JSON.parse(run('npx', ['--offline', '--yes', '--package=' + tarball, '0721c', 'init', npxTarget, '--dry-run', '--json'], scratch));
  assert.equal(npxPlan.initialized, false);
  await assert.rejects(access(npxTarget), { code: 'ENOENT' });
  const cli = join(consumer, 'node_modules/.bin/0721c');
  const destination = join(consumer, 'standalone-deployment');
  const plan = JSON.parse(run(cli, ['init', destination, '--dry-run', '--json']));
  assert.equal(plan.initialized, false); await assert.rejects(access(destination), { code: 'ENOENT' });
  const guard = join(consumer, 'offline-guard.mjs');
  await writeFile(guard, `globalThis.fetch = () => { throw new Error('No network during local tooling checks'); };`);
  const local = args => run(process.execPath, ['--import', guard, cli, ...args]);
  const initialized = JSON.parse(local(['init', destination, '--json']));
  assert.equal(initialized.initialized, true); assert.equal(initialized.version, pkg.version);
  assert.equal('deploymentId' in initialized, false);
  assert.equal(git(destination, 'status', '--porcelain'), ''); assert.equal(git(destination, 'remote'), '');
  assert.deepEqual(git(destination, 'branch', '--format=%(refname:short)').trim().split('\n'), ['comments', 'index', 'main']);
  for (const branch of ['main', 'comments', 'index']) {
    assert.equal(git(destination, 'rev-list', '--parents', '-n', '1', branch).trim().split(' ').length, 1);
    assert.doesNotMatch(git(destination, 'ls-tree', '-r', '--name-only', branch), /deployment\.json|manifest\.json|reservation|node_modules/);
  }
  for (const branch of ['comments', 'index']) assert.equal(git(destination, 'ls-tree', '-r', '--name-only', branch), 'README.md\n');
  const runtimePaths = paths.filter(path => /^src\/(core|automation)\//.test(path));
  for (const path of runtimePaths) {
    assert.equal(await readFile(join(destination, '.0721c/runtime', path.slice(4)), 'utf8'), await readFile(join(consumer, 'node_modules/0721c', path), 'utf8'), `Runtime copy differs: ${path}`);
  }
  run(process.execPath, ['--import', guard, '--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    for (const path of ${JSON.stringify(runtimePaths.filter(path => path.endsWith('.mjs')).map(path => `./.0721c/runtime/${path.slice(4)}`))}) await import(path);
    const {buildIndexes} = await import('./.0721c/runtime/automation/build-index.mjs');
    const {validateSettings} = await import('./.0721c/runtime/core/index.mjs');
    const result = buildIndexes({records:[{id:'article/essay/slug/20261005T000000000Z-abcdef123456',blog_id:'article/essay/slug',reply_to:null,author:{login:'user'},created_at:'2026-10-05T00:00:00Z',body_markdown:'Hello'}],settings:validateSettings()});
    assert.equal(result.indexes['article/essay/slug'].comments[0].id,'article/essay/slug/20261005T000000000Z-abcdef123456'); assert.equal('manifest' in result,false);
  `], destination);
  const refsBefore = git(destination, 'show-ref');
  assert.equal(JSON.parse(local(['init', destination, '--json'])).unchanged, true);
  git(destination, 'remote', 'add', 'origin', 'git@github.com:example-owner/site-comments.git');
  const config = await readFile(join(destination, '.git/config'));
  assert.equal(JSON.parse(local(['init', destination, '--json'])).unchanged, true);
  assert.deepEqual(await readFile(join(destination, '.git/config')), config);
  const upgrade = JSON.parse(local(['upgrade', '--directory', destination, '--json']));
  assert.equal(upgrade.status, 'unchanged'); assert.equal(upgrade.applied, false);
  assert.equal(git(destination, 'show-ref'), refsBefore);
  const httpsTarget = join(consumer, 'existing-https-deployment'); await mkdir(httpsTarget);
  git(httpsTarget, 'init', '--template=', '--initial-branch=main');
  git(httpsTarget, 'remote', 'add', 'origin', 'https://github.com/example-owner/site-comments.git');
  const httpsConfig = await readFile(join(httpsTarget, '.git/config'));
  assert.equal(JSON.parse(local(['init', httpsTarget, '--json'])).initialized, true);
  assert.deepEqual(await readFile(join(httpsTarget, '.git/config')), httpsConfig);

  install(`vue@${pkg.devDependencies.vue}`, `typescript@${pkg.devDependencies.typescript}`);
  run(process.execPath, ['--import', guard, '--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    assert.equal(typeof window,'undefined');
    const {Comments0721c,create0721c} = await import('0721c/vue'); assert.ok(Comments0721c); assert.equal(typeof create0721c,'function');
    const {createSSRApp,h} = await import('vue');
    const {renderToString} = await import('vue/server-renderer');
    const app = createSSRApp({render:()=>h(Comments0721c,{articleId:'article/essay/slug'})});
    app.use(create0721c({repository:'example/comments',messages:{loading:'Connect to GitHub',title:'Discussion'}}));
    const html = await renderToString(app);
    assert.ok(html.includes('Connect to GitHub')); assert.ok(html.includes('Discussion'));
    const {resolveContentArticle} = await import('0721c/content');
    assert.equal(resolveContentArticle({path:'/article/essay/slug',stem:'article/other',id:'unrelated'}).articleId,'article/essay/slug');
    const {ContentComments0721c} = await import('0721c/nuxt-content'); assert.ok(ContentComments0721c);
    const {loadAssets} = await import('./node_modules/0721c/src/cli/assets.mjs');
    const assets = await loadAssets(); assert.equal(assets.version,${JSON.stringify(pkg.version)});
    assert.ok(assets.main['.github/workflows/publish-index.yml']);
    const cli = await import('./node_modules/0721c/src/cli/index.mjs');
    assert.equal('configure' in cli,false); assert.equal('resolveToken' in cli,false);
  `]);
  assert.match(run(cli, ['--help']), /0721c init/);
  assert.equal(run(cli, ['--version']).trim(), pkg.version);
  const checkTypes = file => run(process.execPath, [join(consumer, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2022', '--lib', 'ES2022,DOM,DOM.Iterable', file]);
  await copyFile(join(root, 'tests/consumer.ts'), join(consumer, 'consumer.ts')); checkTypes('consumer.ts');
  const cliTypes = (await readFile(join(root, 'tests/cli/consumer.ts'), 'utf8')).replaceAll('../../src/', './node_modules/0721c/src/');
  await writeFile(join(consumer, 'cli-consumer.ts'), cliTypes); checkTypes('cli-consumer.ts');
  install(`@nuxt/kit@${pkg.devDependencies['@nuxt/kit']}`);
  run(process.execPath, ['--import', guard, '--input-type=module', '-e', `import assert from 'node:assert/strict'; import module from '0721c/nuxt'; assert.equal((await module.getMeta()).configKey,'comments0721c');`]);
  const nuxtTypes = (await readFile(join(root, 'tests/nuxt/consumer.ts'), 'utf8')).replaceAll('../../src/', './node_modules/0721c/src/');
  await writeFile(join(consumer, 'nuxt-consumer.ts'), nuxtTypes); checkTypes('nuxt-consumer.ts');
  console.log(JSON.stringify({ tarball, integrity: packed.integrity, files: packed.entryCount, size: packed.size, consumer: '0721c@' + pkg.version + ': library, types, deployment and npx checks passed' }, null, 2));
} finally {
  await rm(consumer, { recursive: true, force: true });
  await rm(join(scratch, 'npm-logs'), { recursive: true, force: true });
  await rm(join(scratch, 'npm-user.conf'), { force: true });
  await rm(join(scratch, 'npm-global.conf'), { force: true });
}
