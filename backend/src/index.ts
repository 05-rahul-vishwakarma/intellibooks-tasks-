import "./env";
import express from "express";
import cors from "cors";
import { clerkMiddleware, getAuth } from "@clerk/express";
import documentRoutes from "./routes/documents";
import chatRoutes from "./routes/chat";
import messageRoutes from "./routes/messages";

const app = express();
const PORT = process.env.PORT || 8000;

app.use(cors({ origin: process.env.FRONTEND_URL || "http://localhost:3000" }));
app.use(express.json({ limit: "20mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "intellibooks-backend" });
});

// Clerk auth middleware (verifies JWT on every request)
app.use(
  clerkMiddleware({
    publishableKey:
      process.env.CLERK_PUBLISHABLE_KEY ||
      process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    secretKey: process.env.CLERK_SECRET_KEY,
  })
);

// requireUser: returns 401 if no authenticated userId
function requireUser(req: express.Request, res: express.Response, next: express.NextFunction) {
  const userId = getAuth(req).userId;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  (req as any).userId = userId;
  next();
}

app.use(requireUser);

app.use("/api/documents", documentRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/messages", messageRoutes);

app.listen(PORT, () => {
  console.log(`IntelliBooks backend listening on :${PORT}`);
});

export default app;