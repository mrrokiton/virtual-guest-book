export type DomainErrorCode =
  | 'not_found'
  | 'forbidden'
  | 'unauthorized'
  | 'invalid_state'
  | 'limit_exceeded'
  | 'invalid_input'
  | 'rate_limited'
  | 'unsupported_media';

export class DomainError extends Error {
  constructor(
    public readonly code: DomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

const HTTP_STATUS: Record<DomainErrorCode, number> = {
  not_found: 404,
  forbidden: 403,
  unauthorized: 401,
  invalid_state: 409,
  limit_exceeded: 413,
  invalid_input: 400,
  rate_limited: 429,
  unsupported_media: 415,
};

export function httpStatusFor(code: DomainErrorCode): number {
  return HTTP_STATUS[code];
}
