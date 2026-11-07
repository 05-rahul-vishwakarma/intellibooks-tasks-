import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isAuthRoute = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)"]);

export default clerkMiddleware((auth, req) => {
  const { userId } = auth();

  // The app shell (dashboard/chat) is public so guests can browse it, like
  // ChatGPT and DeepSeek. Uploading and chatting prompt sign-in instead.
  // Already-authenticated users don't need the auth pages.
  if (userId && isAuthRoute(req)) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }
});

export const config = {
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};
