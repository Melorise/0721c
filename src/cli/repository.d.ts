export interface RepositoryIdentity {
  owner: string; repo: string; url: string; rawBaseUrl: string;
}
export interface RepositoryOptions {
  repository?: string;
  directory?: string;
  execFileImpl?: (file: string, args: string[], options: Record<string, unknown>) => Promise<{ stdout: string }>;
}
export function normalizeCLIRepository(input: string): RepositoryIdentity;
export function resolveRepository(options?: RepositoryOptions): Promise<RepositoryIdentity>;
