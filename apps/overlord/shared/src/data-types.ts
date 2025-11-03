import { Agent } from "./agents-types.js";
import { LogEntry } from "./log-types.js";
import { ThreadMessage } from "./mail-types.js";

export interface ReadStatus {
  lastReadLogId: number;
  latestLogId: number;
  lastReadMailId: number;
  latestMailId: number;
}

export interface NaisysDataResponse {
  success: boolean;
  message: string;
  data?: {
    agents: Agent[];
    logs: LogEntry[];
    mail: ThreadMessage[];
    timestamp: string;
    readStatus: Record<string, ReadStatus>;
  };
}

export interface NaisysDataRequest {
  logsAfter?: string;
  logsLimit?: string;
  mailAfter?: string;
  mailLimit?: string;
}

export interface ReadStatusUpdateRequest {
  agentName: string;
  lastReadLogId?: number;
  lastReadMailId?: number;
}

export interface ReadStatusUpdateResponse {
  success: boolean;
  message: string;
}
