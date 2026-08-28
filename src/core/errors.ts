export type DogerErrorCode =
  | "ALREADY_RUNNING"
  | "CONFIG_INVALID"
  | "CREDENTIALS_INVALID"
  | "CREDENTIALS_MISSING"
  | "STATE_INVALID"
  | "STORAGE_ERROR";

export class DogerError extends Error {
  readonly code: DogerErrorCode;

  constructor(code: DogerErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DogerError";
    this.code = code;
  }
}
