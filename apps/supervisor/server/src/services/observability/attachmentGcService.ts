import { existsSync, unlinkSync } from "fs";

import { hubDb } from "../../database/hubDb.js";
import { getLogger } from "../../logger.js";

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

// Uploads insert the attachments row before the link row, so brand-new rows
// are briefly orphaned by design — skip them or we'd race the link insert.
const UPLOAD_GRACE_MS = 60 * 60 * 1000; // 1 hour

// To register a new attachment-using table, add `<table>: { none: {} }` to
// both predicates below.
export async function runAttachmentGc(): Promise<{
  rowsDeleted: number;
  filesDeleted: number;
}> {
  const cutoff = new Date(Date.now() - UPLOAD_GRACE_MS);
  const orphans = await hubDb.attachments.findMany({
    where: {
      created_at: { lt: cutoff },
      mail_attachments: { none: {} },
      user_startup_attachments: { none: {} },
      context_logs: { none: {} },
    },
    select: { id: true, filepath: true, file_hash: true },
  });
  if (orphans.length === 0) return { rowsDeleted: 0, filesDeleted: 0 };

  // Per-row predicate re-asserted so a ref inserted after the snapshot skips.
  const purged: { filepath: string; fileHash: string }[] = [];
  for (const o of orphans) {
    const result = await hubDb.attachments.deleteMany({
      where: {
        id: o.id,
        created_at: { lt: cutoff },
        mail_attachments: { none: {} },
        user_startup_attachments: { none: {} },
        context_logs: { none: {} },
      },
    });
    if (result.count > 0) {
      purged.push({ filepath: o.filepath, fileHash: o.file_hash });
    }
  }

  // Storage is content-addressed; only unlink when no other row uses the hash.
  const seenHash = new Set<string>();
  let filesDeleted = 0;
  for (const { filepath, fileHash } of purged) {
    if (seenHash.has(fileHash)) continue;
    seenHash.add(fileHash);
    const sharing = await hubDb.attachments.count({
      where: { file_hash: fileHash },
    });
    if (sharing > 0) continue;
    try {
      if (existsSync(filepath)) {
        unlinkSync(filepath);
        filesDeleted++;
      }
    } catch (err) {
      getLogger().warn(
        `[AttachmentGC] Failed to delete file ${filepath}: ${String(err)}`,
      );
    }
  }

  return { rowsDeleted: purged.length, filesDeleted };
}

export function startAttachmentGc(
  intervalMs: number = DEFAULT_INTERVAL_MS,
): { stop: () => void } {
  const tick = () => {
    runAttachmentGc()
      .then(({ rowsDeleted, filesDeleted }) => {
        if (rowsDeleted > 0 || filesDeleted > 0) {
          getLogger().info(
            `[AttachmentGC] Purged ${rowsDeleted} rows, ${filesDeleted} files`,
          );
        }
      })
      .catch((err) => {
        getLogger().error(
          `[AttachmentGC] Sweep failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
  };

  // Run once on startup so dev cycles don't have to wait an hour.
  tick();
  const handle = setInterval(tick, intervalMs);
  handle.unref?.();
  return { stop: () => clearInterval(handle) };
}
