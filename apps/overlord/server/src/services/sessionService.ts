import {
  selectFromOverlordDb,
  runOnOverlordDb,
} from "../database/overlordDatabase.js";

export interface Session {
  token: string;
  startDate: string;
  expireDate: string;
}

export async function createSession(
  token: string,
  startDate: Date,
  expireDate: Date,
): Promise<void> {
  await runOnOverlordDb(
    `
    INSERT INTO sessions (token, start_date, expire_date)
    VALUES (?, ?, ?)
  `,
    [token, startDate.toISOString(), expireDate.toISOString()],
  );
}

export async function getSession(token: string): Promise<Session | null> {
  const sessions = await selectFromOverlordDb<Session[] | null>(
    `
    SELECT token, start_date as startDate, expire_date as expireDate
    FROM sessions
    WHERE token = ? AND expire_date > datetime('now')
  `,
    [token],
  );

  if (sessions && sessions.length > 0) {
    return sessions[0];
  } else {
    return null;
  }
}

export async function deleteExpiredSessions(): Promise<void> {
  await runOnOverlordDb(
    `
    DELETE FROM sessions WHERE expire_date <= datetime('now')
  `,
  );
}

export async function deleteSession(token: string): Promise<void> {
  await runOnOverlordDb(
    `
    DELETE FROM sessions WHERE token = ?
  `,
    [token],
  );
}
