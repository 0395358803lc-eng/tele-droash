import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import Database from "better-sqlite3";

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForHealth(baseUrl, child, diagnostics) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(
        `API exited before becoming healthy (code ${child.exitCode}):\n${diagnostics()}`,
      );
    }
    try {
      const response = await fetch(`${baseUrl}/api/healthz`);
      if (response.ok) return await response.json();
    } catch {
      // Startup race: retry until the deadline below.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`API health check timed out:\n${diagnostics()}`);
}

async function stopChild(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (child.exitCode === null) {
    child.kill("SIGKILL");
  }
}

test("health works and live account lease rejects job before durable creation", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "telegram-checker-api-"));
  const databasePath = path.join(tempDir, "checker.db");
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const apiEntry = path.resolve("dist", "index.mjs");
  let stdout = "";
  let stderr = "";

  const child = spawn(process.execPath, [apiEntry], {
    cwd: path.resolve("."),
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      NODE_ENV: "test",
      DATABASE_PATH: databasePath,
      SESSION_SECRET: "integration-test-session-secret-0123456789abcdef",
    },
  });
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const diagnostics = () => [stdout, stderr].filter(Boolean).join("\n").slice(-8000);

  try {
    const health = await waitForHealth(baseUrl, child, diagnostics);
    assert.equal(health.status, "ok");
    assert.equal(health.database.ok, true);

    const db = new Database(databasePath);
    try {
      const now = Date.now();
      const accountId = "integration-account-busy";
      const phone = "+84900000123";
      const accountKey = createHash("sha256")
        .update(phone, "utf8")
        .digest("hex")
        .slice(0, 16);
      const leaseUntil = new Date(Date.now() + 60_000).toISOString();

      db.prepare(
        `INSERT INTO telegram_accounts (
          id, phone_number, status, api_id_encrypted, api_hash_encrypted,
          session_encrypted, created_at, updated_at
        ) VALUES (?, ?, 'connected', ?, ?, ?, ?, ?)`,
      ).run(
        accountId,
        phone,
        "unused-api-id",
        "unused-api-hash",
        "unused-session",
        now,
        now,
      );
      db.prepare(
        `INSERT INTO account_worker_state (
          account_key, worker_id, worker_heartbeat_at, worker_lease_until,
          job_id, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        accountKey,
        "integration-worker",
        new Date().toISOString(),
        leaseUntil,
        "existing-job",
        new Date().toISOString(),
      );

      const response = await fetch(
        `${baseUrl}/api/telegram-accounts/${accountId}/check`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ phones: ["+84911111111"] }),
        },
      );
      const body = await response.json();

      assert.equal(response.status, 409);
      assert.match(body.message, /durable worker/i);

      const durableJobs = db.prepare("SELECT COUNT(*) AS count FROM jobs").get();
      const metadataJobs = db
        .prepare("SELECT COUNT(*) AS count FROM telegram_jobs")
        .get();
      assert.equal(durableJobs.count, 0);
      assert.equal(metadataJobs.count, 0);
    } finally {
      db.close();
    }
  } finally {
    await stopChild(child);
    await rm(tempDir, { recursive: true, force: true });
  }
});
