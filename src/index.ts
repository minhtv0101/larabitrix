import { Hono } from "hono";
import type { Env } from "./types";
import { authMiddleware } from "./middleware/auth";
import { listsRouter, cacheRouter } from "./routes/lists";
import { crmRouter } from "./routes/crm";
import { BitrixApiError } from "./services/bitrix24-client";

const app = new Hono<{ Bindings: Env }>();

// Public health check (no auth required)
app.get("/health", (c) => c.json({ success: true, data: { status: "ok" } }));

// Auth guard for all /api/* routes
app.use("/api/*", authMiddleware());

// Route mounts
app.route("/api/lists", listsRouter);
app.route("/api/crm", crmRouter);
app.route("/api/cache", cacheRouter);

// Global error handler
app.onError((err, c) => {
  if (err instanceof BitrixApiError) {
    return c.json(
      { success: false, error: err.message, code: err.code },
      (err.httpStatus ?? 502) as 502
    );
  }
  console.error(err);
  return c.json({ success: false, error: "internal_error" }, 500);
});

app.notFound((c) => c.json({ success: false, error: "not_found" }, 404));

export default app;
