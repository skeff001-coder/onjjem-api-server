/**
 * Free Scan Route — tracks one free breed scan per Apple User ID.
 *
 * Storage: a simple JSON file on Railway's persistent filesystem.
 * This avoids needing a database while surviving server restarts.
 *
 * Endpoints:
 *   GET  /api/free-scan/status?appleUserId=xxx
 *   POST /api/free-scan/consume  { appleUserId: string }
 */

import { Router, type Request, type Response } from "express";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

const router = Router();

// ── Storage ────────────────────────────────────────────────────────────────────
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || "/tmp";
const DATA_FILE = join(DATA_DIR, "free_scans.json");
const FREE_SCAN_LIMIT = 1;

function readStore(): Record<string, number> {
  try {
    if (!existsSync(DATA_FILE)) return {};
    return JSON.parse(readFileSync(DATA_FILE, "utf8"));
  } catch {
    return {};
  }
}

function writeStore(store: Record<string, number>): void {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(DATA_FILE, JSON.stringify(store), "utf8");
  } catch (err) {
    console.error("free-scan: failed to write store", err);
  }
}

// ── GET /api/free-scan/status ──────────────────────────────────────────────────
// Returns how many free scans the user has used and how many remain.
router.get("/free-scan/status", (req: Request, res: Response) => {
  const { appleUserId } = req.query as { appleUserId?: string };

  if (!appleUserId || typeof appleUserId !== "string") {
    res.status(400).json({ error: "appleUserId is required" });
    return;
  }

  const store = readStore();
  const scansUsed = store[appleUserId] ?? 0;
  const remaining = Math.max(0, FREE_SCAN_LIMIT - scansUsed);

  res.json({
    scansUsed,
    remaining,
    limit: FREE_SCAN_LIMIT,
  });
});

// ── POST /api/free-scan/consume ────────────────────────────────────────────────
// Attempts to consume one free scan for the given Apple User ID.
// Returns { allowed: true } if the scan was granted,
//         { allowed: false } if the limit has been reached.
router.post("/free-scan/consume", (req: Request, res: Response) => {
  const { appleUserId } = req.body as { appleUserId?: string };

  if (!appleUserId || typeof appleUserId !== "string") {
    res.status(400).json({ error: "appleUserId is required" });
    return;
  }

  const store = readStore();
  const scansUsed = store[appleUserId] ?? 0;

  if (scansUsed >= FREE_SCAN_LIMIT) {
    res.json({
      allowed: false,
      remaining: 0,
      limit: FREE_SCAN_LIMIT,
    });
    return;
  }

  // Grant the scan and increment the counter
  store[appleUserId] = scansUsed + 1;
  writeStore(store);

  res.json({
    allowed: true,
    remaining: FREE_SCAN_LIMIT - store[appleUserId],
    limit: FREE_SCAN_LIMIT,
  });
});

export default router;
