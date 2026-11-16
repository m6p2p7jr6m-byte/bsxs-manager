/** Klasy błędów aplikacji. Każdy błąd ma kod i czytelny komunikat po polsku. */

export class AppError extends Error {
  constructor(message, code = 'app_error', details = null) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
  }
}

export class ValidationError extends AppError {
  constructor(message, details = null) {
    super(message, 'validation', details);
    this.name = 'ValidationError';
  }
}

export class AuthzError extends AppError {
  constructor(message = 'Brak uprawnień do tej operacji.', details = null) {
    super(message, 'authz', details);
    this.name = 'AuthzError';
  }
}

/** kind: 'credentials' | 'locked' | 'mfa' | 'session' | 'policy' */
export class AuthError extends AppError {
  constructor(message, kind = 'credentials', details = null) {
    super(message, 'auth', details);
    this.name = 'AuthError';
    this.kind = kind;
  }
}

export class StorageError extends AppError {
  constructor(message, details = null) {
    super(message, 'storage', details);
    this.name = 'StorageError';
  }
}

/** Zamienia dowolny wyjątek na bezpieczny komunikat dla użytkownika. */
export function toMessage(err, fallback = 'Wystąpił nieoczekiwany błąd.') {
  if (!err) return fallback;
  if (err instanceof AppError) return err.message;
  if (typeof err === 'string' && err.trim()) return err;
  if (err && typeof err.message === 'string' && err.message.trim()) return err.message;
  return fallback;
}

export function isAppError(err) {
  return err instanceof AppError;
}
