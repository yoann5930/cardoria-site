/**
 * Rotation sauvegardes — conserve N dernières, sans modifier backup/full.js.
 */
import fs from "fs";
import path from "path";
import { listBackups } from "../backup/full.js";
import { DATA_DIR } from "../storage.js";
import { logAudit } from "../audit.js";

export function rotateBackups(maxKeep = Number(process.env.BACKUP_MAX_KEEP || 14)) {
  const backups = listBackups();
  if (backups.length <= maxKeep) {
    return { ok: true, kept: backups.length, removed: 0 };
  }
  const toRemove = backups.slice(maxKeep);
  let removed = 0;
  toRemove.forEach((b) => {
    const dir = path.join(DATA_DIR, "backups", b.id);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
      removed++;
    }
  });
  if (removed > 0) {
    logAudit({ type: "backup", action: "rotate", user: "system", detail: `removed=${removed}, keep=${maxKeep}` });
  }
  return { ok: true, kept: maxKeep, removed };
}
