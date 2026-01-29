import { DatabaseService } from "@naisys/database";
import {
  AgentLogRequestSchema,
  AgentStartRequestSchema,
  AgentStopRequestSchema,
  HubEvents,
  type AgentLogRequest,
  type AgentLogResponse,
  type AgentStartResponse,
  type AgentStopRequest,
  type AgentStopResponse,
} from "@naisys/hub-protocol";
import { AgentManager } from "../agent/agentManager.js";
import { HostService } from "../services/hostService.js";
import { HubClientLog } from "./hubClientLog.js";
import { HubManager } from "./hubManager.js";

/** Base request type with target host info */
interface RemoteRequest {
  targetUserId: string;
  targetHostId: string;
}

/** Base response type */
interface RemoteResponse {
  success: boolean;
  error?: string;
}

/** User info returned from lookup */
interface UserInfo {
  id: string;
  username: string;
  host_id: string;
}

/**
 * Handles incoming remote agent control requests on the runner side.
 * Receives start/stop/log requests from the hub and executes them locally.
 */
export function createRemoteAgentHandler(
  hubManager: HubManager,
  hubClientLog: HubClientLog,
  dbService: DatabaseService,
  hostService: HostService,
  agentManager: AgentManager,
) {
  const { localHostId } = hostService;

  init();

  function init() {
    hubManager.registerEvent(HubEvents.AGENT_START, handleAgentStartRequest);
    hubManager.registerEvent(HubEvents.AGENT_STOP, handleAgentStopRequest);
    hubManager.registerEvent(HubEvents.AGENT_LOG, handleAgentLogRequest);

    hubClientLog.write("[RemoteAgentHandler] Initialized");
  }

  /**
   * Validates request and looks up user, returning null on error (after calling ack).
   */
  async function validateAndLookupUser<TRes extends RemoteResponse>(
    operation: string,
    rawData: unknown,
    schema: {
      safeParse: (data: unknown) => {
        success: boolean;
        data?: RemoteRequest;
        error?: { issues: unknown };
      };
    },
    ack: ((response: TRes) => void) | undefined,
  ): Promise<{ data: RemoteRequest; user: UserInfo } | null> {
    const errorResponse = { success: false } as TRes;

    // Validate request schema
    const result = schema.safeParse(rawData);
    if (!result.success) {
      hubClientLog.error(
        `[RemoteAgentHandler] Invalid agent ${operation} request: ${JSON.stringify(result.error?.issues)}`,
      );
      ack?.({ ...errorResponse, error: "Invalid request format" });
      return null;
    }

    const data = result.data!;
    hubClientLog.write(
      `[RemoteAgentHandler] Received agent ${operation} request for user ${data.targetUserId}`,
    );

    // Verify this request is for our host
    if (data.targetHostId !== localHostId) {
      hubClientLog.error(
        `[RemoteAgentHandler] Request for different host: ${data.targetHostId} (we are ${localHostId})`,
      );
      ack?.({ ...errorResponse, error: "Request received by wrong host" });
      return null;
    }

    // Look up the user
    const user = await dbService.usingDatabase(async (prisma) => {
      return await prisma.users.findUnique({
        where: { id: data.targetUserId },
        select: { id: true, username: true, host_id: true },
      });
    });

    if (!user) {
      hubClientLog.error(
        `[RemoteAgentHandler] User ${data.targetUserId} not found`,
      );
      ack?.({ ...errorResponse, error: `User ${data.targetUserId} not found` });
      return null;
    }

    // Verify user belongs to this host
    if (user.host_id !== localHostId) {
      hubClientLog.error(
        `[RemoteAgentHandler] User ${user.username} belongs to host ${user.host_id}, not ${localHostId}`,
      );
      ack?.({
        ...errorResponse,
        error: `User ${user.username} is not on this host`,
      });
      return null;
    }

    return { data, user: user as UserInfo };
  }

  async function handleAgentStartRequest(
    rawData: unknown,
    ack?: (response: AgentStartResponse) => void,
  ) {
    const validated = await validateAndLookupUser<AgentStartResponse>(
      "start",
      rawData,
      AgentStartRequestSchema,
      ack,
    );
    if (!validated) return;

    const { user } = validated;

    try {
      // Start the agent (agentManager.startAgent checks if already running)
      const agentRunId = await agentManager.startAgent(user.id);
      hubClientLog.write(
        `[RemoteAgentHandler] Started agent ${user.username} (ID: ${agentRunId})`,
      );
      ack?.({ success: true });
    } catch (error) {
      hubClientLog.error(`[RemoteAgentHandler] Error starting agent: ${error}`);
      ack?.({ success: false, error: String(error) });
    }
  }

  async function handleAgentStopRequest(
    rawData: unknown,
    ack?: (response: AgentStopResponse) => void,
  ) {
    const validated = await validateAndLookupUser<AgentStopResponse>(
      "stop",
      rawData,
      AgentStopRequestSchema,
      ack,
    );
    if (!validated) return;

    const { user } = validated;
    const data = rawData as AgentStopRequest; // Already validated

    try {
      // Stop the agent (agentManager.stopAgentByUserId checks if running)
      await agentManager.stopAgentByUserId(user.id, data.reason);
      hubClientLog.write(`[RemoteAgentHandler] Stopped agent ${user.username}`);
      ack?.({ success: true });
    } catch (error) {
      hubClientLog.error(`[RemoteAgentHandler] Error stopping agent: ${error}`);
      ack?.({ success: false, error: String(error) });
    }
  }

  async function handleAgentLogRequest(
    rawData: unknown,
    ack?: (response: AgentLogResponse) => void,
  ) {
    const validated = await validateAndLookupUser<AgentLogResponse>(
      "log",
      rawData,
      AgentLogRequestSchema,
      ack,
    );
    if (!validated) return;

    const { user } = validated;
    const data = rawData as AgentLogRequest; // Already validated

    try {
      const logs = await dbService.usingDatabase(async (prisma) => {
        return await prisma.context_log.findMany({
          where: { user_id: user.id },
          orderBy: { created_at: "desc" },
          take: data.lines,
          select: { message: true },
        });
      });

      const lines = logs.reverse().map((log) => log.message);
      hubClientLog.write(
        `[RemoteAgentHandler] Returning ${lines.length} log lines for ${user.username}`,
      );
      ack?.({ success: true, lines });
    } catch (error) {
      hubClientLog.error(
        `[RemoteAgentHandler] Error getting agent logs: ${error}`,
      );
      ack?.({ success: false, error: String(error) });
    }
  }

  return {};
}

export type RemoteAgentHandler = ReturnType<typeof createRemoteAgentHandler>;
