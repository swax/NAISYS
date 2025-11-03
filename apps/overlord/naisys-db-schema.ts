export const createUserTable = `CREATE TABLE IF NOT EXISTS Users (
    id INTEGER PRIMARY KEY, 
    username TEXT NOT NULL,
    title TEXT NOT NULL,
    agentPath TEXT NOT NULL,
    leadUsername TEXT,
    lastActive TEXT DEFAULT '',
    UNIQUE(username),
    UNIQUE(agentPath)
  )`;

export const createThreadsTable = `CREATE TABLE IF NOT EXISTS Threads (
    id INTEGER PRIMARY KEY, 
    subject TEXT NOT NULL,
    tokenCount INTEGER NOT NULL DEFAULT 0
  )`;

export const createThreadMembersTable = `CREATE TABLE IF NOT EXISTS ThreadMembers (
    id INTEGER PRIMARY KEY, 
    threadId INTEGER NOT NULL, 
    userId INTEGER NOT NULL,
    newMsgId INTEGER NOT NULL DEFAULT -1,
    archived INTEGER NOT NULL DEFAULT 0,
    UNIQUE(threadId,userId),
    FOREIGN KEY(threadId) REFERENCES Threads(id),
    FOREIGN KEY(userId) REFERENCES Users(id)
  )`;

export const createThreadMessagesTable = `CREATE TABLE IF NOT EXISTS ThreadMessages (
    id INTEGER PRIMARY KEY, 
    threadId INTEGER NOT NULL, 
    userId INTEGER NOT NULL, 
    message TEXT NOT NULL,
    date TEXT NOT NULL,
    FOREIGN KEY(threadId) REFERENCES Threads(id),
    FOREIGN KEY(userId) REFERENCES Users(id)
  )`;

export const createCostsTable = `CREATE TABLE IF NOT EXISTS Costs (
    id INTEGER PRIMARY KEY,
    date TEXT NOT NULL, 
    username TEXT NOT NULL,
    subagent TEXT,
    source TEXT NOT NULL,
    model TEXT NOT NULL,
    cost REAL DEFAULT 0,
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    cache_write_tokens INTEGER DEFAULT 0,
    cache_read_tokens INTEGER DEFAULT 0
  )`;

export const createDreamLogTable = `CREATE TABLE IF NOT EXISTS DreamLog (
    id INTEGER PRIMARY KEY, 
    username TEXT NOT NULL,
    date TEXT NOT NULL,
    dream TEXT NOT NULL
  )`;

export const createContextLogTable = `CREATE TABLE IF NOT EXISTS ContextLog (
    id INTEGER PRIMARY KEY, 
    username TEXT NOT NULL,
    role TEXT NOT NULL,
    source TEXT NOT NULL,
    type TEXT NOT NULL,
    message TEXT NOT NULL,
    date TEXT NOT NULL
  )`;

export const createContextLogIndexes = `
  CREATE INDEX IF NOT EXISTS idx_contextlog_id_desc ON ContextLog(id DESC);
`;

export const createDreamLogIndexes = `
  CREATE INDEX IF NOT EXISTS idx_dreamlog_id_desc ON DreamLog(id DESC);
`;

export const createCostsIndexes = `
  CREATE INDEX IF NOT EXISTS idx_costs_id_desc ON Costs(id DESC);
`;

export const createThreadsIndexes = `
  CREATE INDEX IF NOT EXISTS idx_threads_id_desc ON Threads(id DESC);
`;

export const createThreadMessagesIndexes = `
  CREATE INDEX IF NOT EXISTS idx_threadmessages_id_desc ON ThreadMessages(id DESC);
  CREATE INDEX IF NOT EXISTS idx_threadmessages_threadid ON ThreadMessages(threadId);
`;

export const createThreadMembersIndexes = `
  CREATE INDEX IF NOT EXISTS idx_threadmembers_threadid ON ThreadMembers(threadId);
`;
