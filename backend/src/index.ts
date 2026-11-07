import "./env";
import express from "express";
import cors from "cors";
import multer from "multer";
import { clerkMiddleware, getAuth } from "@clerk/express";
import documentRoutes from "./routes/documents";
import chatRoutes from "./routes/chat";
import messageRoutes from "./routes/messages";

const app = express();
const PORT = process.env.PORT || 8000;
const MAX_FILE_SIZE_MB = process.env.MAX_FILE_SIZE_MB || "20";

app.use(cors({ origin: process.env.FRONTEND_URL || "http://localhost:3000" }));
// Chat payloads are tiny; uploads use multipart (multer) and are limited separately.
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "intellibooks-backend" });
});

// Clerk auth middleware (verifies the session JWT on every request).
app.use(
  clerkMiddleware({
    publishableKey:
      process.env.CLERK_PUBLISHABLE_KEY ||
      process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    secretKey: process.env.CLERK_SECRET_KEY,
  })
);

// requireUser: returns 401 if no authenticated userId.
function requireUser(req: express.Request, res: express.Response, next: express.NextFunction) {
  const userId = getAuth(req).userId;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  req.userId = userId;
  next();
}

app.use(requireUser);

app.use("/api/documents", documentRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/messages", messageRoutes);

// Unknown route → JSON 404 (instead of Express's HTML default).
app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Global error handler. Never leaks stack traces to clients.
app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    if (res.headersSent) {
      // A streaming response already started; we cannot send a JSON body.
      return;
    }

    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({
          error: `File too large. Maximum size is ${MAX_FILE_SIZE_MB} MB.`,
        });
      }
      return res.status(400).json({ error: err.message });
    }

    const maybe = err as { status?: number; type?: string; message?: string };

    if (maybe?.type === "entity.parse.failed") {
      return res.status(400).json({ error: "Invalid JSON body" });
    }

    const status =
      typeof maybe?.status === "number" && maybe.status >= 400 && maybe.status < 600
        ? maybe.status
        : 500;

    if (status >= 500) {
      console.error("Unhandled error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }

    return res.status(status).json({ error: maybe?.message || "Request failed" });
  }
);

app.listen(PORT, () => {
  console.log(`IntelliBooks backend listening on :${PORT}`);
});

export default app;
