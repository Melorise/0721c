export interface PublicClient {
  request(method: 'GET', path: string): Promise<any>;
}
export interface SettingsInput {
  schema_version?: 1;
  articlePolicy?: { mode?: 'open' | 'allowlist'; disabledIds?: string[] };
  limits?: { bodyCodepoints?: number; bodyBytes?: number; maxReplyDepth?: number };
  locale?: 'zh-CN' | 'en';
}
export interface Articles {
  schema_version: 1;
  articles: Record<string, { enabled: boolean; title?: string; url?: string }>;
}
export interface Check { code: string; ok: boolean; message: string; error?: unknown }
export interface DoctorOptions {
  repository?: string; directory?: string; packageRoot?: string;
  githubClient?: PublicClient; fetchImpl?: typeof fetch;
  /** Reads one local origin URL; no authentication helper. */
  execFileImpl?: (file: string, args: string[], options: Record<string, unknown>) => Promise<{ stdout: string }>;
}
export interface InitOptions {
  directory?: string; packageRoot?: string; dryRun?: boolean;
  settings?: SettingsInput; articles?: Articles; locale?: 'zh-CN' | 'en'; now?: Date;
}
export interface InitResult {
  command: 'init'; directory: string; version: string;
  status: 'planned' | 'initialized'; initialized: boolean;
  branches: Partial<Record<'main' | 'comments' | 'index', string>>;
  manual: string[]; dryRun?: boolean; unchanged?: boolean;
  plan?: { files: string[]; branches: string[] };
}
export interface DoctorResult {
  command: 'doctor'; repository: string; ok: boolean;
  status: 'healthy' | 'unhealthy'; checks: Check[];
}
export interface UpgradeChange { path: string; kind: 'add' | 'delete' | 'modify'; diff: string }
export interface UpgradePlan {
  command: 'upgrade'; directory: string; version: string;
  status: 'planned' | 'unchanged' | 'updated'; applied: boolean;
  dryRun: boolean; changes: UpgradeChange[]; preserved: string[]; manual?: string[];
}
export interface UpgradeOptions {
  directory?: string; packageRoot?: string; apply?: boolean; dryRun?: boolean;
  onPlan?: (plan: UpgradePlan) => void | Promise<void>;
}
export class CLIError extends Error { code: string; details: Record<string, unknown>; constructor(code: string, message: string, details?: Record<string, unknown>); }
export function init(options?: InitOptions): Promise<InitResult>;
export function doctor(options?: DoctorOptions): Promise<DoctorResult>;
export function upgrade(options?: UpgradeOptions): Promise<UpgradePlan>;
export function parseArgs(argv: string[]): { command: 'init' | 'doctor' | 'upgrade' | 'help' | 'version'; options: Record<string, any> };
export function runCLI(argv: string[], dependencies?: DoctorOptions & { write?: (text: string) => void; writeError?: (text: string) => void; onPlan?: UpgradeOptions['onPlan'] }): Promise<number>;
export const HELP: string;
