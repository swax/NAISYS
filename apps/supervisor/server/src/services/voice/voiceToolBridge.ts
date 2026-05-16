import { dbSubagentIdToWire } from "@naisys/common";
import type {
  Permission,
  VoiceToolCallRequest,
  VoiceToolCallResponse,
  VoiceToolName,
} from "@naisys/supervisor-shared";

import { hubDb } from "../../database/hubDb.js";
import { getLogger } from "../../logger.js";
import { resolveAgentId } from "../agents/agentService.js";
import { sendChatMessage } from "../comms/chatService.js";
import { sendAgentRunCommand } from "../comms/hubConnectionService.js";

/**
 * Executes voice-agent tool calls against the target NAISYS agent. Every call
 * is re-authorized in routes/voice.ts so the voice agent can't do anything
 * the operator couldn't do by hand. All three tools ride existing injection
 * paths. See docs/019-voice-agent.md.
 */

/** The permission a given voice tool requires of the operator. */
export function requiredPermissionForVoiceTool(
  tool: VoiceToolName,
): Permission {
  // talk_to_agent is the chat path; the other two inject shell commands.
  return tool === "talk_to_agent" ? "agent_communication" : "remote_execution";
}

/**
 * Execute one tool call. `from` is X — the agent perspective the session
 * speaks as (the page's `{agent}`), already resolved by the route. Returns a
 * short text result for the realtime model to use as the tool output; failures
 * are returned (not thrown) so the model can narrate them to the operator.
 */
export async function executeVoiceTool(
  from: { id: number; username: string },
  call: VoiceToolCallRequest,
): Promise<VoiceToolCallResponse> {
  const targetId = resolveAgentId(call.targetUsername);
  if (targetId === undefined) {
    return {
      success: false,
      result: `Unknown agent "${call.targetUsername}".`,
    };
  }

  // Tool 1 — talk to the agent. Goes through the normal chat path so it
  // carries a real sender (X) and reaches the agent's LLM as inbound chat.
  if (call.tool === "talk_to_agent") {
    const res = await sendChatMessage(from.id, [targetId], call.message);
    return {
      success: res.success,
      result: res.success
        ? `Message sent to ${call.targetUsername} as ${from.username}.`
        : (res.message ?? "Failed to send the message."),
    };
  }

  // Tools 2 & 3 — inject a command into the target's most-recently-active run
  // session. Resolving the session server-side keeps it fresh across compaction
  // and naturally follows a subagent if that's where the work currently is.
  const session = await hubDb.run_session.findFirst({
    where: { user_id: targetId },
    orderBy: { last_active: "desc" },
    select: { run_id: true, session_id: true, subagent_id: true },
  });
  if (!session) {
    return {
      success: false,
      result: `${call.targetUsername} has no active run to send commands to. Use talk_to_agent instead; chat delivery can wake or delegate to the agent.`,
    };
  }

  // run_command bridges input + output into the agent's context via ns-cmd
  // (the `!` alias); run_debug_command runs bare, so its output lands in the
  // run log only and the agent's LLM never sees it.
  const command =
    call.tool === "run_command" ? `!${call.command}` : call.command;

  try {
    const res = await sendAgentRunCommand(
      targetId,
      session.run_id,
      session.session_id,
      command,
      dbSubagentIdToWire(session.subagent_id),
    );
    if (!res.success) {
      return {
        success: false,
        result: res.error
          ? `${res.error}. If the target is not running or the session is stale, use talk_to_agent instead; chat delivery can wake or delegate to the agent.`
          : "The command could not be dispatched. Use talk_to_agent instead if the target is not running.",
      };
    }
    return {
      success: true,
      result:
        call.tool === "run_command"
          ? `Ran \`${call.command}\` on ${call.targetUsername}; its input and output were added to the agent's context. Watch the run log for results.`
          : `Ran \`${call.command}\` on ${call.targetUsername} as a diagnostic — the agent does not see it. Watch the run log for output.`,
    };
  } catch (error) {
    getLogger().error(error, "[Voice] run command dispatch failed");
    return {
      success: false,
      result:
        error instanceof Error
          ? error.message
          : "The command could not be dispatched.",
    };
  }
}
