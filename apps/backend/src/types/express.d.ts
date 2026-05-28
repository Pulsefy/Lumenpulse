import 'express-serve-static-core';

declare module 'express-serve-static-core' {
  interface Request {
    /** Optional request-scoped UUID added by RequestIdMiddleware */
    requestId?: string;
  }
}

export {};

// Also augment the top-level 'express' module for any imports that directly
// reference `express.Request` instead of the underlying core types.
declare module 'express' {
  interface Request {
    requestId?: string;
  }
}
declare module 'express-serve-static-core' {
  interface Request {
    requestId?: string;
  }
}

export {};
