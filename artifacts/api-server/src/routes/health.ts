import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { checkDatabaseHealth } from "@workspace/db";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const database = checkDatabaseHealth();
  const status = database.ok ? "ok" : "degraded";
  const data = HealthCheckResponse.parse({
    status,
    database: { ok: database.ok, detail: database.ok ? null : database.detail },
  });
  if (!database.ok) {
    return res.status(503).json(data);
  }
  return res.json(data);
});

export default router;
