export type DogerErrorCode =
  | "ALREADY_RUNNING"
  | "CONFIG_INVALID"
  | "CONFIG_MIGRATION_REQUIRED"
  | "CURL_EXECUTION_FAILED"
  | "DEPENDENCY_MISSING"
  | "STATE_INVALID"
  | "STORAGE_ERROR"
  | "TOKEN_INVALID"
  | "TOKEN_MISSING";

export class DogerError extends Error {
  readonly code: DogerErrorCode;

  constructor(code: DogerErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DogerError";
    this.code = code;
  }
}
