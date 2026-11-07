import type { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Wrap an async Express handler so rejected promises are forwarded to the
 * global error middleware instead of becoming unhandled rejections.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/** An error with an intentional HTTP status code that is safe to show clients. */
export class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "HttpError";
  }
}
