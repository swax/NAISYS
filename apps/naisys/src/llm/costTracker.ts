import { calculatePeriodBoundaries } from "@naisys/common";
import {
  COST_FLUSH_INTERVAL_MS,
  CostControlSchema,
  CostWriteEntry,
  HubEvents,
} from "@naisys/hub-protocol";
import { AgentConfig } from "../agent/agentConfig.js";
import { GlobalConfig } from "../globalConfig.js";
import { HubClient } from "../hub/hubClient.js";
import { RunService } from "../services/runService.js";
import { LLModels } from "./llModels.js";

export interface LlmModelCosts {
  inputCost: number;
  outputCost: number;
  cacheWriteCost?: number;
  cacheReadCost?: number;
}

interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
}

export interface ModelCostData {
  cost: number;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
}

export interface PeriodInfo {
  periodCost: number;
  periodStart: Date;
  periodEnd: Date;
}

export function createCostTracker(
  { globalConfig }: GlobalConfig,
  { agentConfig }: AgentConfig,
  llModels: LLModels,
  runService: RunService,
  hubClient: HubClient,
  localUserId: string,
) {
  const isHubMode = globalConfig().isHubMode;

  // In-memory per-model aggregated costs (always maintained, both modes)
  const modelCosts = new Map<string, ModelCostData>();

  // Running total cost for this agent
  let totalCost = 0;

  // Period tracking for local mode spend limits
  let periodCost = 0;
  let currentPeriodEnd = 0;

  // Hub mode: buffer for batched cost writes
  const buffer: CostWriteEntry[] = [];

  let flushInterval: NodeJS.Timeout | null = null;
  if (isHubMode) {
    flushInterval = setInterval(flush, COST_FLUSH_INTERVAL_MS);
  }

  // Hub mode: receive cost control messages from hub
  let hubCostControlReason: string | undefined;

  if (isHubMode) {
    hubClient.registerEvent(HubEvents.COST_CONTROL, (data: unknown) => {
      const parsed = CostControlSchema.parse(data);
      if (parsed.userId !== localUserId) return;

      if (parsed.enabled) {
        hubCostControlReason = undefined;
      } else {
        hubCostControlReason = parsed.reason;
      }
    });
  }

  function updateInMemory(
    modelKey: string,
    cost: number,
    inputTokens: number,
    outputTokens: number,
    cacheWriteTokens: number,
    cacheReadTokens: number,
  ) {
    const existing = modelCosts.get(modelKey);
    if (existing) {
      existing.cost += cost;
      existing.inputTokens += inputTokens;
      existing.outputTokens += outputTokens;
      existing.cacheWriteTokens += cacheWriteTokens;
      existing.cacheReadTokens += cacheReadTokens;
    } else {
      modelCosts.set(modelKey, {
        cost,
        inputTokens,
        outputTokens,
        cacheWriteTokens,
        cacheReadTokens,
      });
    }

    totalCost += cost;
    addCostToPeriod(cost);
  }

  function pushToBuffer(
    source: string,
    modelKey: string,
    cost: number,
    inputTokens: number,
    outputTokens: number,
    cacheWriteTokens: number,
    cacheReadTokens: number,
  ) {
    const { getRunId, getSessionId } = runService;

    buffer.push({
      userId: localUserId,
      runId: getRunId(),
      sessionId: getSessionId(),
      source,
      model: modelKey,
      cost,
      inputTokens,
      outputTokens,
      cacheWriteTokens,
      cacheReadTokens,
    });
  }

  // Record token usage for LLM calls
  function recordTokens(
    source: string,
    modelKey: string,
    inputTokens: number = 0,
    outputTokens: number = 0,
    cacheWriteTokens: number = 0,
    cacheReadTokens: number = 0,
  ) {
    const model = llModels.get(modelKey);
    const tokenUsage: TokenUsage = {
      inputTokens,
      outputTokens,
      cacheWriteTokens,
      cacheReadTokens,
    };
    const cost = calculateCostFromTokens(tokenUsage, model);

    updateInMemory(
      modelKey,
      cost,
      inputTokens,
      outputTokens,
      cacheWriteTokens,
      cacheReadTokens,
    );

    if (isHubMode) {
      pushToBuffer(
        source,
        modelKey,
        cost,
        inputTokens,
        outputTokens,
        cacheWriteTokens,
        cacheReadTokens,
      );
    }
  }

  // Record fixed cost for non-token services like image generation
  function recordCost(cost: number, source: string, modelKey: string) {
    updateInMemory(modelKey, cost, 0, 0, 0, 0);

    if (isHubMode) {
      pushToBuffer(source, modelKey, cost, 0, 0, 0, 0);
    }
  }

  // Common function to calculate cost from token usage
  function calculateCostFromTokens(
    tokenUsage: TokenUsage,
    model: LlmModelCosts,
  ): number {
    const inputCost = (tokenUsage.inputTokens * model.inputCost) / 1_000_000;
    const outputCost = (tokenUsage.outputTokens * model.outputCost) / 1_000_000;
    const cacheWriteCost =
      (tokenUsage.cacheWriteTokens * (model.cacheWriteCost || 0)) / 1_000_000;
    const cacheReadCost =
      (tokenUsage.cacheReadTokens * (model.cacheReadCost || 0)) / 1_000_000;

    return inputCost + outputCost + cacheWriteCost + cacheReadCost;
  }

  function addCostToPeriod(cost: number) {
    const now = Date.now();
    if (now >= currentPeriodEnd) {
      // Period rolled over, reset
      const spendLimitHours =
        agentConfig().spendLimitHours || globalConfig().spendLimitHours;
      if (spendLimitHours !== undefined) {
        const { periodEnd } = calculatePeriodBoundaries(spendLimitHours);
        currentPeriodEnd = periodEnd.getTime();
      }
      periodCost = 0;
    }
    periodCost += cost;
  }

  // Check if the current spend limit has been reached and throw an error if so
  // In hub mode, checks the cost control state received from the hub
  function checkSpendLimit() {
    if (isHubMode) {
      if (hubCostControlReason) {
        throw `LLM ${hubCostControlReason}`;
      }
      return;
    }

    const spendLimitHours =
      agentConfig().spendLimitHours || globalConfig().spendLimitHours;
    const spendLimit =
      agentConfig().spendLimitDollars || globalConfig().spendLimitDollars || -1;

    let currentCost: number;
    let periodDescription: string;

    if (spendLimitHours !== undefined) {
      const { periodStart, periodEnd } =
        calculatePeriodBoundaries(spendLimitHours);

      // Ensure period is current
      const now = Date.now();
      if (now >= currentPeriodEnd) {
        currentPeriodEnd = periodEnd.getTime();
        periodCost = 0;
      }

      currentCost = periodCost;

      const formatTime = (date: Date) => {
        return date.toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
        });
      };
      periodDescription = `per ${spendLimitHours} hour${spendLimitHours !== 1 ? "s" : ""} (current period: ${formatTime(periodStart)} - ${formatTime(periodEnd)})`;
    } else {
      currentCost = totalCost;
      periodDescription = "total";
    }

    if (spendLimit < currentCost) {
      const userDescription = agentConfig().spendLimitDollars
        ? `${agentConfig().username}`
        : "all users";
      throw `LLM Spend limit of $${spendLimit} ${periodDescription} reached for ${userDescription}, current cost $${currentCost.toFixed(2)}`;
    }
  }

  // Hub buffer flush
  function flush() {
    if (buffer.length === 0) return;

    const entries = buffer.splice(0, buffer.length);
    hubClient.sendMessage(HubEvents.COST_WRITE, { entries });
  }

  function cleanup() {
    if (flushInterval) {
      clearInterval(flushInterval);
      flushInterval = null;
    }
    if (isHubMode) {
      flush();
    }
  }

  // Exposed for costDisplayService
  function getModelCosts(): Map<string, ModelCostData> {
    return modelCosts;
  }

  function getTotalCost(): number {
    return totalCost;
  }

  function getPeriodInfo(): PeriodInfo | null {
    const spendLimitHours =
      agentConfig().spendLimitHours || globalConfig().spendLimitHours;
    if (spendLimitHours === undefined) return null;

    const { periodStart, periodEnd } =
      calculatePeriodBoundaries(spendLimitHours);
    return { periodCost, periodStart, periodEnd };
  }

  function resetCosts() {
    modelCosts.clear();
    totalCost = 0;
    periodCost = 0;
  }

  return {
    recordTokens,
    recordCost,
    calculateCostFromTokens,
    checkSpendLimit,
    cleanup,
    getModelCosts,
    getTotalCost,
    getPeriodInfo,
    resetCosts,
  };
}

export type CostTracker = ReturnType<typeof createCostTracker>;
