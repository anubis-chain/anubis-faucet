export class HttpError extends Error {
  constructor(status, code, message, retryAfter) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

export class StateConflictError extends Error {
  constructor(message = 'The claim state changed concurrently.') {
    super(message);
    this.name = 'StateConflictError';
    this.code = 'STATE_CONFLICT';
  }
}

export function publicError(error) {
  if (error instanceof HttpError) {
    return {
      status: error.status,
      code: error.code,
      message: error.message,
      retryAfter: error.retryAfter,
    };
  }
  return {
    status: 503,
    code: 'TEMPORARILY_UNAVAILABLE',
    message: 'The faucet is temporarily unavailable.',
  };
}
