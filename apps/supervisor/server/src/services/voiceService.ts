import { createHash } from "node:crypto";

import {
  ADMIN_USERNAME,
  computeRealtimeModelCost,
  DEFAULT_REALTIME_MODEL_ID,
  getRealtimeModel,
  parseSpendLimitsFromConfigJson,
} from "@naisys/common";
import { sumUserCostsInPeriod } from "@naisys/hub-database";
import type { VoiceMode, VoiceUsage } from "@naisys/supervisor-shared";
import { voiceToolsForMode } from "@naisys/supervisor-shared";

import { hubDb } from "../database/hubDb.js";
import { getLogger } from "../logger.js";
import { getVariableCachedValue } from "./variableService.js";

/**
 * Voice agent backend — mints ephemeral gpt-realtime session tokens and prices
 * voice usage. The realtime session itself runs in the browser over WebRTC;
 * this service never touches audio. See docs/019-voice-agent.md.
 */

/** Default gpt-realtime model. Override with the VOICE_AGENT_MODEL variable. */
const DEFAULT_VOICE_MODEL = DEFAULT_REALTIME_MODEL_ID;

/** Output voice for the realtime model. */
const VOICE_AGENT_VOICE = "marin";

/** Reuses the OPENAI_API_KEY variable that NAISYS OpenAI models use, so the
 *  operator configures it once. */
const OPENAI_API_KEY_VAR = "OPENAI_API_KEY";
const VOICE_MODEL_VAR = "VOICE_AGENT_MODEL";

const OPENAI_CLIENT_SECRETS_URL =
  "https://api.openai.com/v1/realtime/client_secrets";

export interface VoiceParticipant {
  username: string;
  title: string;
}

export async function getVoiceModel(): Promise<string> {
  const override = await getVariableCachedValue(VOICE_MODEL_VAR);
  return override?.trim() || DEFAULT_VOICE_MODEL;
}

export interface VoiceAvailability {
  available: boolean;
  /** Surfaced as the disabled-tooltip on the voice button. */
  reason?: string;
}

/** Static voice availability for /client-config. Per-session checks (budget,
 *  target shape) still run at mint. */
export async function getVoiceAvailability(): Promise<VoiceAvailability> {
  const apiKey = await getVariableCachedValue(OPENAI_API_KEY_VAR);
  if (!apiKey?.trim()) {
    return {
      available: false,
      reason: `Voice is unavailable: set the ${OPENAI_API_KEY_VAR} variable to enable it.`,
    };
  }

  const override = (await getVariableCachedValue(VOICE_MODEL_VAR))?.trim();
  const modelId = override || DEFAULT_VOICE_MODEL;
  if (!getRealtimeModel(modelId)) {
    return {
      available: false,
      reason: override
        ? `Voice is unavailable: ${VOICE_MODEL_VAR} is set to "${modelId}", which is not a known realtime model.`
        : `Voice is unavailable: default realtime model "${modelId}" is not in the known catalog.`,
    };
  }

  return { available: true };
}

/** Stable, non-reversible per-user id for OpenAI's safety tooling. */
function safetyIdentifier(userUuid: string): string {
  return createHash("sha256").update(userUuid).digest("hex").slice(0, 32);
}

/** System prompt baked into the locked session config. Mode shapes the
 *  tool-list description; chat mode also tells the model commands are off. */
function buildVoiceInstructions(
  from: VoiceParticipant,
  target: VoiceParticipant,
  mode: VoiceMode,
): string {
  const toolDescriptions =
    mode === "chat"
      ? [
          `You have one tool for dispatching to your work loop:`,
          `- talk_to_agent: queue a chat message to your work loop. It will be picked up on the next work cycle. Use this to take on new work or to converse with your own deeper reasoning. Responses are not immediate.`,
          ``,
          `You cannot run shell commands from this voice session — the operator opened it from a chat thread, so only the chat path is available. Use talk_to_agent to ask the work loop to run commands itself.`,
        ]
      : [
          `You have three tools for dispatching to your work loop:`,
          `- talk_to_agent: queue a chat message to your work loop. It will be picked up on the next work cycle. Use this to take on new work or to converse with your own deeper reasoning. Responses are not immediate.`,
          `- run_debug_command: run a shell command on your host for diagnostics. The output comes back only to you here in the voice channel via the run log — your work loop does not see it. Use this to check on things without disturbing your working memory. Only works while your work loop is actively running.`,
          `- run_command: run a shell command and place its input and output into your work loop's context, as if you had run it there yourself. Use this to hand your work loop a concrete result to act on. Only works while your work loop is actively running.`,
          ``,
          `If your work loop is not running, do not use the command tools. Use talk_to_agent to queue the operator's request; chat delivery can wake you, and you'll act on it when you start or reach your next cycle.`,
        ];

  return [
    `You are the real-time voice interface for an AI agent on NAISYS, an AI agent platform. You are the ears and mouth of "${target.title}" (${target.username}). Speak as ${target.username} in the first person throughout — "I'm doing X", "I ran Y", "I found Z" — never in the third person, even when reporting work done by your background loop.`,
    `The human operator "${from.title}" (${from.username}) has opened a voice session to talk to you in real time, without waiting for your normal work-cycle chat replies.`,
    ``,
    `Your actual work — code, commands, reasoning — runs in a separate background loop, not in this voice channel. When the operator asks you to do something, dispatch it to that loop using the tools below; don't try to satisfy it from the voice channel alone. You answer directly here only for things you can already see in your run log.`,
    ``,
    `Assume the operator cannot see any screen — voice is their only channel. They cannot read chat messages, command output, tool results, or the run log; only what you say out loud reaches them. When you do or retrieve something on their behalf, speak the substance, not just the action. "I sent it" or "I did it" without the actual content is a failed reply.`,
    ``,
    ...toolDescriptions,
    ``,
    `You are continuously fed entries from your own run log. Use it as context; do NOT narrate it play-by-play. Most log activity passes silently. Speak up only when there's something the operator needs to hear: an answer to what they asked, a result they're waiting on, a blocker, a decision point, or a meaningful state change. Be concise — one or two sentences with the substance, not a recap. Skip routine tool calls, intermediate states, dead ends, false starts, spinners, and token-budget warnings.`,
    ``,
    `Image attachments in the run log (e.g. desktop screenshots) are delivered to you as image content alongside the text digest. When the operator asks about something visual — "what's on screen?", "what does that error dialog say?" — describe what you see directly rather than waiting for the work loop to read it back.`,
    ``,
    `Talk about what you have, not what you're waiting on or don't have yet. While a dispatched command or query is in flight, don't narrate the wait ("standing by", "any moment now", "waiting for it to come back"). Acknowledge the dispatch once if needed, then go quiet until results arrive. If the operator asks in the meantime, share what you already have from the log so far, not the absence of the rest.`,
    ``,
    `End your replies when you've said what you need to say. Don't append "what would you like next?", "let me know if...", "just say the word", "anything else?", or similar trailing offers. The session stays open — the operator will speak again when they want to. Silence is fine.`,
  ].join("\n");
}

/** Function-tool definitions for the realtime session. The target agent is
 *  locked at mint, so the model only supplies the message/command — the
 *  browser fills in the target when forwarding. */
function buildVoiceTools(mode: VoiceMode) {
  const all = {
    talk_to_agent: {
      type: "function",
      name: "talk_to_agent",
      description:
        "Send a chat message to the target agent. It is received as normal inbound chat and acted on during the agent's next work cycle. Use to delegate work or converse with the agent's reasoning. Not an immediate request/response.",
      parameters: {
        type: "object",
        properties: {
          message: {
            type: "string",
            description: "The chat message to send to the target agent.",
          },
        },
        required: ["message"],
      },
    },
    run_debug_command: {
      type: "function",
      name: "run_debug_command",
      description:
        "Run a shell command on the target agent's host for diagnostics. Only use this when the target agent is already running with an active run session. If the target is stopped or has no active run, use talk_to_agent instead so chat delivery can wake/delegate to the agent. The agent does NOT see the command or its output — only you do, via the run log.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "The shell command to run.",
          },
        },
        required: ["command"],
      },
    },
    run_command: {
      type: "function",
      name: "run_command",
      description:
        "Run a shell command and place its input and output into the target agent's working context, as if the agent had run it. Only use this when the target agent is already running with an active run session. If the target is stopped or has no active run, use talk_to_agent instead so chat delivery can wake/delegate to the agent.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "The shell command to run.",
          },
        },
        required: ["command"],
      },
    },
  } as const;

  return voiceToolsForMode(mode).map((name) => all[name]);
}

export interface MintedVoiceToken {
  clientSecret: string;
  expiresAt: string;
  model: string;
}

/**
 * Mint an ephemeral gpt-realtime client secret with the locked session config.
 * The browser uses the returned secret to open a WebRTC call directly to
 * OpenAI; the session config (instructions, tools, voice) is baked in here and
 * cannot be changed client-side. Mode scopes the baked tool set and shapes the
 * system message accordingly.
 */
export async function mintVoiceToken(opts: {
  from: VoiceParticipant;
  target: VoiceParticipant;
  userUuid: string;
  mode: VoiceMode;
}): Promise<MintedVoiceToken> {
  const apiKey = await getVariableCachedValue(OPENAI_API_KEY_VAR);
  if (!apiKey) {
    throw new Error(
      `Voice agent unavailable: the ${OPENAI_API_KEY_VAR} variable is not set.`,
    );
  }

  const model = await getVoiceModel();

  const session = {
    type: "realtime",
    model,
    instructions: buildVoiceInstructions(opts.from, opts.target, opts.mode),
    audio: { output: { voice: VOICE_AGENT_VOICE } },
    tools: buildVoiceTools(opts.mode),
    tool_choice: "auto",
  };

  const response = await fetch(OPENAI_CLIENT_SECRETS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "OpenAI-Safety-Identifier": safetyIdentifier(opts.userUuid),
    },
    body: JSON.stringify({ session }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    getLogger().error(
      `[Voice] client_secrets mint failed (${response.status}): ${body}`,
    );
    throw new Error(
      `Failed to start voice session (OpenAI returned ${response.status}).`,
    );
  }

  const data = (await response.json()) as {
    value?: string;
    expires_at?: number;
    client_secret?: { value?: string; expires_at?: number };
  };

  // The client_secrets endpoint returns { value, expires_at }; tolerate the
  // older { client_secret: { value, expires_at } } shape defensively.
  const clientSecret = data.value ?? data.client_secret?.value;
  const expiresAtUnix = data.expires_at ?? data.client_secret?.expires_at;

  if (!clientSecret) {
    getLogger().error(
      `[Voice] client_secrets response missing token value: ${JSON.stringify(data)}`,
    );
    throw new Error("Failed to start voice session (no token returned).");
  }

  const expiresAt = expiresAtUnix
    ? new Date(expiresAtUnix * 1000).toISOString()
    : new Date(Date.now() + 60_000).toISOString();

  return { clientSecret, expiresAt, model };
}

export interface ComputedVoiceCost {
  cost: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

/**
 * Price one turn's usage. The usage buckets are non-overlapping (cached tokens
 * are reported separately from uncached), matching the costs table's
 * input/output/cache_read columns. Image tokens are priced separately by
 * computeRealtimeModelCost but folded into the input/cache_read buckets here
 * because the costs table has no image column.
 */
export function computeVoiceCost(
  model: string,
  usage: VoiceUsage,
): ComputedVoiceCost {
  const cost = computeRealtimeModelCost(model, usage);
  return {
    cost,
    inputTokens:
      usage.inputTextTokens + usage.inputAudioTokens + usage.inputImageTokens,
    outputTokens: usage.outputTextTokens + usage.outputAudioTokens,
    cacheReadTokens:
      usage.inputCachedTextTokens +
      usage.inputCachedAudioTokens +
      usage.inputCachedImageTokens,
  };
}

export interface VoiceBudgetStatus {
  /** Per-period spend cap in dollars (from the admin user's config). */
  spendLimit: number;
  /** Cost recorded against the admin user in the current period. */
  periodCost: number;
  /** True when periodCost ≥ spendLimit — voice should be blocked. */
  overBudget: boolean;
  /** Human-readable explanation when overBudget. */
  reason?: string;
}

/**
 * Voice budget check against the admin user's spend cap. Voice runs outside
 * the hub's COST_CONTROL suspension (admin agent's shellModel is "none"), so
 * we enforce the cap ourselves — at mint and per turn. Mirrors the hub's
 * checkAgentSpendLimit period semantics. Returns null when admin doesn't
 * exist or has no cap configured.
 */
export async function checkVoiceBudget(): Promise<VoiceBudgetStatus | null> {
  const admin = await hubDb.users.findUnique({
    where: { username: ADMIN_USERNAME },
    select: {
      id: true,
      config: true,
      user_notifications: { select: { spend_limit_reset_at: true } },
    },
  });
  if (!admin) return null;

  const { spendLimitDollars, spendLimitHours } = parseSpendLimitsFromConfigJson(
    admin.config,
  );
  if (spendLimitDollars === undefined) return null;

  const periodCost = await sumUserCostsInPeriod(hubDb, {
    userId: admin.id,
    spendLimitHours,
    spendLimitResetAt:
      admin.user_notifications?.spend_limit_reset_at ?? undefined,
  });
  const overBudget = periodCost >= spendLimitDollars;

  return {
    spendLimit: spendLimitDollars,
    periodCost,
    overBudget,
    reason: overBudget
      ? `Voice budget exhausted: $${periodCost.toFixed(2)} of $${spendLimitDollars.toFixed(2)} cap used. The cap resets on the next period boundary.`
      : undefined,
  };
}
