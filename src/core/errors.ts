export type DogerErrorCode =
  | "ALREADY_RUNNING"
  | "BROWSER_EXECUTION_FAILED"
  | "BROWSER_OUTPUT_INVALID"
  | "CONFIG_INVALID"
  | "CREDENTIALS_INVALID"
  | "CREDENTIALS_MISSING"
  | "CURL_EXECUTION_FAILED"
  | "DEPENDENCY_MISSING"
  | "RECIPE_INVALID"
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
