export class NoexClientError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'NoexClientError';
    this.code = code;
    this.details = details;
  }
}

export class TimeoutError extends NoexClientError {
  constructor(message: string) {
    super('TIMEOUT', message);
    this.name = 'TimeoutError';
  }
}

export class DisconnectedError extends NoexClientError {
  constructor(message: string = 'Not connected') {
    super('DISCONNECTED', message);
    this.name = 'DisconnectedError';
  }
}
