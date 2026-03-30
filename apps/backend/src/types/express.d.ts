declare module 'express-serve-static-core' {
  interface Request {
    requestId?: string;
  }
}

export {};
