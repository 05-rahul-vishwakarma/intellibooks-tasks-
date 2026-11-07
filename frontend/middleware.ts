import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isPublicRoute = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)"]);

export default clerkMiddleware((auth, req) => {
  const { userId } = auth();
  const isPublic = isPublicRoute(req);

  if (!userId && !isPublic) {
    return auth().redirectToSignIn({ returnBackUrl: req.url });
  }

  if (userId && isPublic) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  if (userId && req.nextUrl.pathname === "/") {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }
});

export const config = {
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};
