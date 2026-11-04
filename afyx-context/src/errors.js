export class AceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AceError';
    this.code = code;
  }
}

export function assertNonEmpty(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new AceError('INVALID_INPUT', `${field} must be a non-empty string`);
  }
  return value;
}
