export type DataAccessErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'INVALID_INPUT'
  | 'UNAVAILABLE';

export class DataAccessError extends Error {
  constructor(public readonly code: DataAccessErrorCode) {
    super(code);
    this.name = 'DataAccessError';
  }
}

export function requireResource<T>(value: T | null): T {
  if (value === null) throw new DataAccessError('NOT_FOUND');
  return value;
}

export function requireUuid(value: string): void {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    throw new DataAccessError('INVALID_INPUT');
  }
}
