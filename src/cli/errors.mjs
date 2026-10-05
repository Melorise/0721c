import { ProtocolError } from '../core/index.mjs';

export class CLIError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'CLIError';
    this.code = code;
    this.details = details;
  }
}

export function fail(code, message, details) {
  throw new CLIError(code, message, details);
}

export function errorSummary(error) {
  // Remote errors can contain request headers or user supplied response bodies.
  // Only locally authored messages and a numeric status cross the CLI boundary.
  if (error instanceof ProtocolError) return { code: error.code, message: error.message, details: { path: 'config/settings.json' } };
  if (error instanceof CLIError) return { code: error.code, message: error.message, details: error.details };
  const status = Number.isInteger(error?.status) ? error.status : undefined;
  return { code: 'REMOTE_OR_IO_FAILURE', message: 'Operation failed; run doctor and resume the same command.', ...(status ? { status } : {}) };
}
