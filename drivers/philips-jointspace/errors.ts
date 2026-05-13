export class JointspaceError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 500) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    Error.captureStackTrace?.(this, this.constructor);
  }
}

export class OfflineError extends JointspaceError {
  constructor(message = "TV is offline") {
    super(message, 503);
  }
}

export class UnauthenticatedError extends JointspaceError {
  constructor(message = "Authentication failed") {
    super(message, 401);
  }
}

export class NotFoundError extends JointspaceError {
  constructor(message = "Endpoint not found") {
    super(message, 404);
  }
}

export class PairingError extends JointspaceError {
  readonly errorId?: string;
  readonly errorText?: string;

  constructor(message: string, errorId?: string, errorText?: string) {
    super(message, 400);
    this.errorId = errorId;
    this.errorText = errorText;
  }
}

export class ProtocolError extends JointspaceError {
  constructor(message = "Protocol error talking to TV") {
    super(message, 502);
  }
}

export class InvalidResponseError extends JointspaceError {
  constructor(message = "Invalid response from TV") {
    super(message, 502);
  }
}

/**
 * Raised during the pair flow when the TV advertises digest_auth_pairing
 * but its HTTPS/1926 server isn't responding. We can't fall back to
 * HTTP/1925 here because pair/request is only available on the secured
 * transport; surfacing the specific cause lets the UI tell the user to
 * power-cycle the TV instead of showing a generic "endpoint not found".
 */
export class HttpsUnavailableError extends JointspaceError {
  constructor(message = "TV HTTPS service is not responding") {
    super(message, 503);
  }
}
