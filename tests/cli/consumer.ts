import { init, doctor, upgrade } from '../../src/cli/index.mjs';
import type { InitOptions, InitResult, DoctorResult, UpgradePlan } from '../../src/cli/index.mjs';
const local: InitOptions = { directory: './comments-new', dryRun: true, locale: 'zh-CN' };
const generated: Promise<InitResult> = init(local);
init();
const diagnostics: Promise<DoctorResult> = doctor({ repository: 'git@github.com:owner/repo.git' });
const updated: Promise<UpgradePlan> = upgrade({ directory: './comments-new', apply: true });
upgrade();
// @ts-expect-error Initialization has no remote options.
init({ repository: 'owner/repo' });
// @ts-expect-error Initialization has no generated deployment identity.
init({ uuid: () => 'not-supported' });
// @ts-expect-error Local update uses the installed files, with no version matrix.
upgrade({ directory: './comments-new', to: '0.1.3' });
// @ts-expect-error Diagnostics have no credential environment.
doctor({ env: { GH_TOKEN: 'not-supported' } });
// @ts-expect-error Automatic configuration has no export.
import { configure } from '../../src/cli/index.mjs';
// @ts-expect-error Credential loading has no export.
import { resolveToken } from '../../src/cli/index.mjs';
void [generated, diagnostics, updated];
