import app from "./app";
import { closeDatabase } from "@workspace/db";
import {
  recoverAndResumeStaleJobs,
  suspendActiveWorkers,
} from "./lib/desktop-engine";
import { logger } from "./lib/logger";

const rawPort = process.env.PORT ?? "3000";
const host = process.env.HOST?.trim() || "127.0.0.1";
const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0 || port > 65535) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

let shuttingDown = false;
let server: ReturnType<typeof app.listen> | undefined;

async function closeHttpServer(): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server!.close((error) => (error ? reject(error) : resolve()));
  });
}

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Shutting down desktop API server");

  const forceTimer = setTimeout(() => {
    logger.error("Graceful shutdown timed out; forcing exit");
    process.exit(1);
  }, 25_000);
  forceTimer.unref();

  try {
    const [, workerResult] = await Promise.all([
      closeHttpServer(),
      suspendActiveWorkers(10_000),
    ]);
    if (workerResult.forced.length) {
      logger.error(
        { jobIds: workerResult.forced },
        "Some durable workers required forced termination",
      );
      process.exitCode = 1;
    } else if (workerResult.graceful.length) {
      logger.info(
        { jobIds: workerResult.graceful },
        "Durable workers suspended cleanly for application shutdown",
      );
    }
  } catch (error) {
    logger.error({ err: error }, "Graceful shutdown failed");
    process.exitCode = 1;
  } finally {
    try {
      closeDatabase();
    } catch (dbError) {
      logger.error({ err: dbError }, "Failed to close SQLite cleanly");
      process.exitCode = 1;
    }
    clearTimeout(forceTimer);
  }
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("uncaughtException", (error) => {
  logger.fatal({ err: error }, "Uncaught exception");
  void shutdown("uncaughtException");
});
process.on("unhandledRejection", (reason) => {
  logger.fatal({ err: reason }, "Unhandled rejection");
  void shutdown("unhandledRejection");
});

async function main() {
  try {
    const recovered = await recoverAndResumeStaleJobs();
    if (recovered.length) {
      logger.warn(
        { jobIds: recovered },
        "Recovered and restarted stale durable jobs",
      );
    }
  } catch (error) {
    logger.error({ err: error }, "Durable job recovery failed during startup");
  }

  server = app.listen(port, host, (error) => {
    if (error) {
      logger.error({ err: error }, "Error listening on port");
      process.exit(1);
    }
    logger.info({ host, port }, "Desktop API server listening");
  });
}

void main();
