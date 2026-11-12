export type ErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "NOT_CONFIGURED"
  | "RATE_LIMITED"
  | "PROVIDER_ERROR"
  | "PROVIDER_RATE_LIMIT"
  | "INSUFFICIENT_CREDITS"
  | "UPSTREAM_TIMEOUT"
  | "INVALID_IMAGE"
  | "INVALID_MODEL"
  | "VERIFICATION_FAILED"
  | "NOT_FOUND"
  | "INTERNAL";

const STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  NOT_CONFIGURED: 503,
  RATE_LIMITED: 429,
  PROVIDER_ERROR: 502,
  PROVIDER_RATE_LIMIT: 429,
  INSUFFICIENT_CREDITS: 402,
  UPSTREAM_TIMEOUT: 504,
  INVALID_IMAGE: 422,
  INVALID_MODEL: 422,
  VERIFICATION_FAILED: 422,
  NOT_FOUND: 404,
  INTERNAL: 500,
};

export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
  get status() {
    return STATUS[this.code];
  }
}

export function toErrorBody(err: unknown) {
  if (err instanceof AppError) {
    return { status: err.status, body: { error: { code: err.code, message: err.message, details: err.details } } };
  }
  console.error("[vehicle3d] errore non gestito", err);
  return {
    status: 500,
    body: { error: { code: "INTERNAL", message: "Errore interno del server. Riprova più tardi." } },
  };
}
