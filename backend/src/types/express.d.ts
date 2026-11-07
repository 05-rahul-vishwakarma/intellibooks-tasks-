/**
 * `requireUser` attaches the verified Clerk user id to the request.
 * This augmentation makes `req.userId` typed instead of using `any`.
 */
declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export {};
