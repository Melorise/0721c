import { publicContext } from './public-context.mjs';
import { errorSummary, fail } from './errors.mjs';
import { checkRepository, configuration, dataFormat } from './inspect.mjs';

/** Anonymous public GET-only checks. Private permissions are never interpreted. */
export async function doctor(options = {}) {
  const { assets, repository, store } = await publicContext(options);
  const report = { command: 'doctor', repository: repository.url, ok: false, status: 'unhealthy', checks: [] };
  const check = async (code, fn, message) => {
    try {
      const value = await fn();
      report.checks.push({ code, ok: value !== false, message });
      return value;
    } catch (error) {
      report.checks.push({ code, ok: false, message, error: errorSummary(error) });
      return undefined;
    }
  };
  const repo = await check('repository', async () => {
    const remote = await store.repository();
    if (!remote) return false;
    checkRepository(remote);
    return remote;
  }, 'The public repository exists and is active.');
  if (!repo) return report;
  for (const branch of ['main', 'comments', 'index']) {
    const snapshot = await check(`${branch}-branch`, async () => await store.snapshot(branch) || false, `The ${branch} branch exists.`);
    if (!snapshot) continue;
    if (branch === 'main') {
      await check('main-files', async () => {
        for (const path of Object.keys(assets.managed)) {
          if (await store.read(snapshot, path) === null) fail('MISSING_RUNTIME_FILE', 'A standard workflow, runtime or README file is missing.', { path });
        }
        return true;
      }, 'Standard runtime, workflows, Issue settings and README files are present.');
      await check('configuration', () => configuration(store, snapshot, assets.core), 'Settings and optional article policy contain valid JSON.');
    } else {
      await check(`${branch}-json`, () => dataFormat(store, snapshot, assets.core, branch), `Existing ${branch} JSON matches its public format and path.`);
    }
  }
  report.checks.push({ code: 'default-main', ok: repo.default_branch === 'main', message: 'The default branch is main.' });
  report.checks.push({ code: 'issues-enabled', ok: repo.has_issues === true, message: 'Issues are enabled.' });
  report.ok = report.checks.every(item => item.ok);
  report.status = report.ok ? 'healthy' : 'unhealthy';
  return report;
}
