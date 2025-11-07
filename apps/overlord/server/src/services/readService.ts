import { LogEntry, ReadStatus, ThreadMessage } from "shared";
import {
  selectFromOverlordDb,
  runOnOverlordDb,
} from "../database/overlordDatabase.js";
import { SettingsRecord } from "./settingsService.js";

function createDefaultReadStatus(): ReadStatus {
  return {
    lastReadLogId: -1,
    latestLogId: -1,
    lastReadMailId: -1,
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

  return JSON.parse(settingsRecords[0].read_status_json || "{}");
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

export async function updateLastReadLogId(
  agentName: string,
  lastReadLogId: number,
): Promise<void> {
  let readStatusByAgent = await getReadStatus();

  // Update the read status for this user and agent
  if (!readStatusByAgent[agentName]) {
    readStatusByAgent[agentName] = createDefaultReadStatus();
  }

  const readStatus = readStatusByAgent[agentName];

  readStatus.lastReadLogId = Math.max(readStatus.lastReadLogId, lastReadLogId);

  // Save back to database
  return await saveReadStatus(readStatusByAgent);
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

export async function updateLastReadMailId(
  agentName: string,
  lastReadMailId: number,
): Promise<void> {
  let readStatusByAgent = await getReadStatus();

  // Update the read status for this user and agent
  if (!readStatusByAgent[agentName]) {
    readStatusByAgent[agentName] = createDefaultReadStatus();
  }

  const readStatus = readStatusByAgent[agentName];

  readStatus.lastReadMailId = Math.max(
    readStatus.lastReadMailId,
    lastReadMailId,
  );

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
