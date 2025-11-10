import { LogEntry, ReadStatus, ThreadMessage } from "shared";
import {
  selectFromOverlordDb,
  runOnOverlordDb,
} from "../database/overlordDatabase.js";
import { SettingsRecord } from "./settingsService.js";

function createDefaultReadStatus(): ReadStatus {
  return {
    latestLogId: -1,
    latestMailId: -1,
  };
}

export async function getReadStatus(): Promise<Record<string, ReadStatus>> {
  const settingsRecords = await selectFromOverlordDb<SettingsRecord[] | null>(`
    SELECT read_status_json
    FROM settings
    WHERE id = 1
  `);

  if (!settingsRecords?.length) {
    return {};
  }

  const storedStatus = JSON.parse(settingsRecords[0].read_status_json || "{}");

  // Strip out lastRead fields (client-side only now)
  const cleanedStatus: Record<string, ReadStatus> = {};
  for (const [agentName, status] of Object.entries(storedStatus)) {
    const typedStatus = status as any;
    cleanedStatus[agentName] = {
      latestLogId: typedStatus.latestLogId ?? -1,
      latestMailId: typedStatus.latestMailId ?? -1,
    };
  }

  return cleanedStatus;
}

async function saveReadStatus(
  readStatusByAgent: Record<string, ReadStatus>,
): Promise<void> {
  await runOnOverlordDb(
    `
    UPDATE settings
    SET read_status_json = ?, modify_date = ?
    WHERE id = 1
  `,
    [JSON.stringify(readStatusByAgent), new Date().toISOString()],
  );
}

export async function updateLatestLogIds(logs: LogEntry[]): Promise<void> {
  if (logs.length === 0) return;

  let readStatusByAgent = await getReadStatus();

  // Update latest log ids for each agent
  logs.forEach((log) => {
    if (!readStatusByAgent[log.username]) {
      readStatusByAgent[log.username] = createDefaultReadStatus();
    }

    const readStatus = readStatusByAgent[log.username];

    readStatus.latestLogId = Math.max(readStatus.latestLogId, log.id);
  });

  // Save back to database
  return await saveReadStatus(readStatusByAgent);
}

export async function updateLatestMailIds(
  mail: ThreadMessage[],
): Promise<void> {
  if (mail.length === 0) return;

  let readStatusByAgent = await getReadStatus();

  // Update latest *received* mail ids for each agent
  mail.forEach((msg) => {
    // For each receiving user in members that is not the sender
    msg.members.forEach((member) => {
      if (member.username !== msg.username) {
        if (!readStatusByAgent[member.username]) {
          readStatusByAgent[member.username] = createDefaultReadStatus();
        }

        const readStatus = readStatusByAgent[member.username];
        readStatus.latestMailId = Math.max(readStatus.latestMailId, msg.id);
      }
    });
  });

  // Save back to database
  return await saveReadStatus(readStatusByAgent);
}
