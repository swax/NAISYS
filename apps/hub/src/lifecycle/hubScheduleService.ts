import {
  ADMIN_USERNAME,
  nextRunAtForSchedules,
  parseSchedulesFromConfigJson,
  prevFireAt,
  type ScheduleEntry,
  wasDueIn,
} from "@naisys/common";
import type { DualLogger } from "@naisys/common-node";
import type { HubDatabaseService } from "@naisys/hub-database";
import { HubEvents, ScheduleTriggerRequestSchema } from "@naisys/hub-protocol";

import type { HubConfigService } from "../config/hubConfigService.js";
import type { HubSendMailService } from "../mail/hubSendMailService.js";
import type { HubCostService } from "../observability/hubCostService.js";
import type { HubRedactionService } from "../observability/hubRedactionService.js";
import type { NaisysServer } from "../server/naisysServer.js";
import type { HubAgentService } from "./hubAgentService.js";
import type { HubOwnershipService } from "./hubOwnershipService.js";

const TICK_INTERVAL_MS = 30_000;
/** Slightly wider than the tick so a slow tick (GC, event-loop block)
 *  doesn't drop a fire. Anything older is intentionally not caught up. */
const FIRE_WINDOW_MS = 60_000;

export interface TriggerNowResult {
  ok: boolean;
  reason: string;
}

function buildScheduleBody(entry: ScheduleEntry): string {
  const prompt = entry.prompt?.trim();
  return prompt
    ? `[schedule: ${entry.name}] ${prompt}`
    : `[schedule: ${entry.name}]`;
}

export function createHubScheduleService(
  naisysServer: NaisysServer,
  { hubDb }: HubDatabaseService,
  logService: DualLogger,
  sendMailService: HubSendMailService,
  agentService: HubAgentService,
  ownershipService: HubOwnershipService,
  costService: HubCostService,
  configService: HubConfigService,
  redactionService: HubRedactionService,
) {
  let adminUserId: number | null = null;

  /** Read the operator-overridable TZ live each tick — `TIMEZONE` can be
   *  changed at runtime via the supervisor variable UI. */
  function getTimezone(): string | undefined {
    return configService.getConfig().config?.hubTimezone;
  }

  async function getAdminUserId(): Promise<number | null> {
    if (adminUserId !== null) return adminUserId;
    const admin = await hubDb.users.findUnique({
      where: { username: ADMIN_USERNAME },
      select: { id: true },
    });
    if (!admin) {
      logService.error(
        `[Hub:Schedule] Admin user "${ADMIN_USERNAME}" not found — scheduler cannot fire`,
      );
      return null;
    }
    adminUserId = admin.id;
    return adminUserId;
  }

  /** The user a schedule fires *from* — the agent replies to whoever sent
   *  the chat, so this also decides who receives the agent's done report
   *  (and can post-process it). Resolution order: the entry's explicit
   *  initiator, then the agent's lead, then admin. */
  async function resolveInitiatorId(
    agentUserId: number,
    entry: ScheduleEntry,
  ): Promise<number | null> {
    if (entry.initiator) {
      const user = await hubDb.users.findUnique({
        where: { username: entry.initiator },
        select: { id: true },
      });
      if (user) return user.id;
      logService.error(
        `[Hub:Schedule] Initiator "${entry.initiator}" not found — falling back to lead/admin`,
      );
    }
    const agent = await hubDb.users.findUnique({
      where: { id: agentUserId },
      select: { lead_user_id: true },
    });
    if (agent?.lead_user_id != null) return agent.lead_user_id;
    return getAdminUserId();
  }

  async function findChatForOccurrence(
    agentUserId: number,
    sourceTag: string,
    since: Date,
  ) {
    return hubDb.mail_messages.findFirst({
      where: {
        source: sourceTag,
        created_at: { gte: since },
        recipients: {
          some: { user_id: agentUserId, type: { not: "from" } },
        },
      },
      orderBy: { id: "desc" },
      select: {
        id: true,
        body: true,
        recipients: {
          where: { user_id: agentUserId, type: { not: "from" } },
          select: { read_at: true, archived_at: true },
        },
      },
    });
  }

  async function fireEntry(
    agentUserId: number,
    agentUsername: string,
    entry: ScheduleEntry,
    opts: { manual?: boolean } = {},
  ): Promise<{ delivered: boolean; reason: string }> {
    const fromUserId = await resolveInitiatorId(agentUserId, entry);
    if (fromUserId === null) {
      return { delivered: false, reason: "initiator/admin user not found" };
    }

    const sourceTag = `schedule:${entry.name}`;
    // Pre-redact so the update-existing-pending path doesn't bypass the
    // redaction sendMailService applies on the initial-send path, and so the
    // body comparison below is redacted-vs-redacted (matching what's stored).
    const body = redactionService.redact(buildScheduleBody(entry));
    const tz = getTimezone();
    const now = new Date();

    // Cron path: scope dedupe to this occurrence so sweepAll doesn't refire
    // a slot whose chat the user already read/archived.
    // Manual path (trigger-now): ignore occurrence boundary — user explicitly
    // wants to fire now, but still dedupe against a pending chat.
    const occurrenceStart = opts.manual
      ? new Date(0)
      : (prevFireAt(entry.cron, now, tz) ?? new Date(0));
    const existing = await findChatForOccurrence(
      agentUserId,
      sourceTag,
      occurrenceStart,
    );
    const recipient = existing?.recipients[0];
    const pending =
      !!recipient &&
      recipient.read_at === null &&
      recipient.archived_at === null;

    let chatStatus: string;
    if (existing && !pending && !opts.manual) {
      // Cron: occurrence already delivered AND processed (chat read or
      // archived). Don't fall through to start — a sweep or restart within
      // the 60s fire window would otherwise relaunch the agent after it
      // already signaled "done" on this occurrence.
      return {
        delivered: true,
        reason: `occurrence already delivered (chat #${existing.id})`,
      };
    } else if (existing && pending) {
      if (existing.body === body) {
        chatStatus = `chat #${existing.id} already pending`;
      } else {
        // Update + bump timestamp; no re-broadcast since the ID is unchanged.
        await hubDb.mail_messages.update({
          where: { id: existing.id },
          data: { body, created_at: now },
        });
        chatStatus = `updated pending chat #${existing.id}`;
        logService.log(
          `[Hub:Schedule] Updated pending chat #${existing.id} for ${agentUsername} (${sourceTag})`,
        );
      }
    } else {
      await sendMailService.sendMail({
        fromUserId,
        recipientUserIds: [agentUserId],
        subject: "",
        body,
        kind: "chat",
        source: sourceTag,
      });
      chatStatus = "sent chat";
      logService.log(
        `[Hub:Schedule] Sent chat to ${agentUsername} (${sourceTag})`,
      );
    }

    const alreadyRunning =
      ownershipService.findHostsForAgent(agentUserId).length > 0;
    if (alreadyRunning) {
      return { delivered: true, reason: `${chatStatus}; agent running` };
    }
    // Refresh suspension state — mail auto-start does the same; without it
    // a limit change during inactivity wouldn't apply until the next cost write.
    await costService.checkSpendLimits([agentUserId]);
    if (costService.isUserSpendSuspended(agentUserId)) {
      // Chat is queued; the agent will be picked up by checkPendingScheduledStarts
      // on the next NAISYS host reconnect, or when a new message arrives.
      // There is no direct hook on spend-limit resume.
      return {
        delivered: true,
        reason: `${chatStatus}; cost-suspended, deferred`,
      };
    }
    const started = await agentService.tryStartAgent(
      agentUserId,
      `schedule:${entry.name}`,
    );
    return {
      delivered: true,
      reason: started
        ? `${chatStatus}; started agent`
        : `${chatStatus}; start declined (no host or already starting)`,
    };
  }

  async function processDueAgent(
    user: {
      id: number;
      username: string;
      config: string;
    },
    now: Date,
  ) {
    const schedules = parseSchedulesFromConfigJson(user.config);
    if (schedules.length === 0) {
      // Schedules removed since next_run_at was set — clear so we stop polling.
      await hubDb.users.update({
        where: { id: user.id },
        data: { next_run_at: null },
      });
      return;
    }

    const tz = getTimezone();
    for (const entry of schedules) {
      if (entry.enabled === false) continue;
      if (!wasDueIn(entry.cron, FIRE_WINDOW_MS, now, tz)) continue;
      try {
        const result = await fireEntry(user.id, user.username, entry);
        if (!result.delivered) {
          logService.log(
            `[Hub:Schedule] Skip ${user.username}/${entry.name}: ${result.reason}`,
          );
        }
      } catch (err) {
        logService.error(
          `[Hub:Schedule] Fire failed for ${user.username}/${entry.name}: ${err}`,
        );
      }
    }

    // Strictly after `now` so a fire we just made doesn't re-trigger.
    const nextRunAt = nextRunAtForSchedules(schedules, now, tz);
    await hubDb.users.update({
      where: { id: user.id },
      data: { next_run_at: nextRunAt },
    });
  }

  let tickInFlight = false;
  let lastSeenTimezone: string | undefined;
  async function tick() {
    if (tickInFlight) return; // slow ticks must not stack
    tickInFlight = true;
    try {
      // TIMEZONE changes propagate via VARIABLES_UPDATED; existing
      // next_run_at rows are stale until reprocessed. A full sweep also
      // fires entries that became due under the new TZ before next_run_at
      // is advanced past them — pure recompute would silently drop those.
      const tz = getTimezone();
      if (lastSeenTimezone !== undefined && tz !== lastSeenTimezone) {
        logService.log(
          `[Hub:Schedule] Timezone changed (${lastSeenTimezone} → ${tz ?? "default"}), sweeping`,
        );
        await sweepAll(new Date());
        lastSeenTimezone = tz;
        return;
      }
      lastSeenTimezone = tz;

      const now = new Date();
      const due = await hubDb.users.findMany({
        where: {
          next_run_at: { lte: now },
          enabled: true,
          archived: false,
        },
        select: { id: true, username: true, config: true },
      });
      for (const user of due) {
        await processDueAgent(user, now);
      }
    } catch (err) {
      logService.error(`[Hub:Schedule] Tick failed: ${err}`);
    } finally {
      tickInFlight = false;
    }
  }

  /** Used on startup and on TZ change — both can leave the cached
   *  next_run_at out of step with the current cron interpretation. */
  async function sweepAll(now: Date) {
    const users = await hubDb.users.findMany({
      where: { enabled: true, archived: false },
      select: { id: true, username: true, config: true },
    });
    for (const u of users) {
      await processDueAgent(u, now);
    }
    logService.log(`[Hub:Schedule] Swept ${users.length} agents`);
  }

  /** Same pipeline as the cron path, but for ad-hoc fires from the UI. */
  async function triggerNow(
    agentUserId: number,
    scheduleName: string,
  ): Promise<TriggerNowResult> {
    const user = await hubDb.users.findUnique({
      where: { id: agentUserId },
      select: { username: true, config: true, enabled: true, archived: true },
    });
    if (!user) return { ok: false, reason: "Agent not found" };
    if (!user.enabled || user.archived) {
      return { ok: false, reason: "Agent is disabled or archived" };
    }
    const schedules = parseSchedulesFromConfigJson(user.config);
    const entry = schedules.find((s) => s.name === scheduleName);
    if (!entry) {
      return { ok: false, reason: `Schedule "${scheduleName}" not found` };
    }
    if (entry.enabled === false) {
      return { ok: false, reason: `Schedule "${scheduleName}" is disabled` };
    }
    try {
      const result = await fireEntry(agentUserId, user.username, entry, {
        manual: true,
      });
      return { ok: result.delivered, reason: result.reason };
    } catch (err) {
      return { ok: false, reason: String(err) };
    }
  }

  naisysServer.registerEvent(
    HubEvents.SCHEDULE_TRIGGER,
    async (_hostId, data, ack) => {
      try {
        const parsed = ScheduleTriggerRequestSchema.parse(data);
        const result = await triggerNow(parsed.userId, parsed.scheduleName);
        ack(result);
      } catch (err) {
        ack({ ok: false, reason: String(err) });
      }
    },
  );

  /** Recompute `next_run_at` for all enabled, non-archived users on any
   *  user change. The hub owns this — the supervisor doesn't know the
   *  authoritative hub TZ until VARIABLES_UPDATED has landed, and a config
   *  save in that window would otherwise persist a wrong-TZ next_run_at and
   *  silently miss the actual occurrence. */
  async function recomputeAllNextRunAt() {
    try {
      const users = await hubDb.users.findMany({
        where: { enabled: true, archived: false },
        select: { id: true, config: true, next_run_at: true },
      });
      const tz = getTimezone();
      const now = new Date();
      for (const u of users) {
        const schedules = parseSchedulesFromConfigJson(u.config);
        const next = nextRunAtForSchedules(schedules, now, tz);
        const currentMs = u.next_run_at?.getTime() ?? null;
        const desiredMs = next?.getTime() ?? null;
        if (currentMs === desiredMs) continue;
        await hubDb.users.update({
          where: { id: u.id },
          data: { next_run_at: next },
        });
      }
    } catch (err) {
      logService.error(`[Hub:Schedule] USERS_CHANGED recompute failed: ${err}`);
    }
  }

  naisysServer.registerEvent(HubEvents.USERS_CHANGED, () => {
    void recomputeAllNextRunAt();
  });

  /** When a NAISYS host connects, kick agents whose schedules queued chats
   *  during a no-host window. Without this, an agent might wait until its
   *  next cron fire (potentially 24h+) even though a host is now available. */
  async function checkPendingScheduledStarts() {
    try {
      // 30d floor lets weekly/monthly schedules catch up after a long
      // outage while still bounding the runaway-restart case where a
      // chat sits unread forever and would re-trigger on every reconnect.
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const pending = await hubDb.mail_messages.findMany({
        where: {
          source: { startsWith: "schedule:" },
          created_at: { gte: since },
          recipients: {
            some: {
              read_at: null,
              archived_at: null,
              type: { not: "from" },
              user: { enabled: true, archived: false },
            },
          },
        },
        select: {
          source: true,
          recipients: {
            where: {
              read_at: null,
              archived_at: null,
              type: { not: "from" },
              user: { enabled: true, archived: false },
            },
            select: { user_id: true },
          },
        },
        orderBy: { id: "desc" },
      });

      // Highest id (most recent) wins so the latest schedule's source
      // tag becomes the new run's triggered_by.
      const seen = new Map<number, string>();
      for (const row of pending) {
        if (!row.source) continue;
        for (const r of row.recipients) {
          if (!seen.has(r.user_id)) seen.set(r.user_id, row.source);
        }
      }

      const activeUserIds = ownershipService.getActiveUserIds();
      const candidates = [...seen.entries()].filter(
        ([userId]) => !activeUserIds.has(userId),
      );
      if (candidates.length === 0) return;

      // Refresh suspension state in bulk before iterating (mirrors mail
      // auto-start). Cached state may be stale after long inactivity.
      await costService.checkSpendLimits(candidates.map(([userId]) => userId));

      for (const [userId, triggeredBy] of candidates) {
        if (costService.isUserSpendSuspended(userId)) continue;
        void agentService.tryStartAgent(userId, triggeredBy);
      }
    } catch (err) {
      logService.error(`[Hub:Schedule] Pending-start sweep failed: ${err}`);
    }
  }

  // Debounce + in-flight guard. Multiple hosts reconnecting together
  // collapse to one sweep that runs 5s after the last connect (giving
  // heartbeats time to populate hostActiveAgents). Without these guards,
  // overlapping sweeps could each see the same agent as inactive and
  // dispatch duplicate starts before tryStartAgent's ack lands.
  let sweepTimer: ReturnType<typeof setTimeout> | null = null;
  let sweepInFlight = false;
  function scheduleSweep() {
    if (sweepTimer) clearTimeout(sweepTimer);
    sweepTimer = setTimeout(async () => {
      sweepTimer = null;
      if (sweepInFlight) return;
      sweepInFlight = true;
      try {
        await checkPendingScheduledStarts();
      } finally {
        sweepInFlight = false;
      }
    }, 5000);
  }

  naisysServer.registerEvent(
    HubEvents.CLIENT_CONNECTED,
    (_hostId, connection) => {
      if (connection.getHostType() === "naisys") {
        scheduleSweep();
      }
    },
  );

  let intervalHandle: ReturnType<typeof setInterval> | null = null;
  let stopped = false;
  function start() {
    // sweepAll fires within-window entries under the current TZ AND
    // refreshes next_run_at — handles both restart-inside-fire-window
    // and TIMEZONE-changed-while-down cases in one pass.
    //
    // Guarded so a transient sweep failure doesn't prevent the interval
    // from installing — otherwise scheduling would stay dead until restart.
    void (async () => {
      try {
        await sweepAll(new Date());
      } catch (err) {
        logService.error(`[Hub:Schedule] Startup sweep failed: ${err}`);
      }
      // If cleanup() ran while the startup sweep was in flight, don't
      // install the interval — it would survive shutdown and later touch
      // a disconnected DB.
      if (stopped) return;
      intervalHandle = setInterval(() => void tick(), TICK_INTERVAL_MS);
    })();
  }

  function cleanup() {
    stopped = true;
    if (intervalHandle) {
      clearInterval(intervalHandle);
      intervalHandle = null;
    }
    if (sweepTimer) {
      clearTimeout(sweepTimer);
      sweepTimer = null;
    }
  }

  return { start, cleanup, triggerNow };
}

export type HubScheduleService = ReturnType<typeof createHubScheduleService>;
