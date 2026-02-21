import stringArgv from "string-argv";
import { AgentConfig } from "../agent/agentConfig.js";
import { costCmd } from "../command/commandDefs.js";
import { RegistrableCommand } from "../command/commandRegistry.js";
import { GlobalConfig } from "../globalConfig.js";
import { OutputService } from "../utils/output.js";
import { CostTracker, LlmModelCosts } from "./costTracker.js";
import { ModelService } from "../services/modelService.js";

export function createCostDisplayService(
  { globalConfig }: GlobalConfig,
  { agentConfig }: AgentConfig,
  costTracker: CostTracker,
  modelService: ModelService,
  output: OutputService,
) {
  function formatCostDetail(
    label: string,
    cost: number,
    tokens: number,
    rate: number,
  ): string {
    return `    ${label}: $${cost.toFixed(4)} for ${tokens.toLocaleString()} tokens at $${rate}/MTokens`;
  }

  function printCosts() {
    const modelCosts = costTracker.getModelCosts();
    const totalStoredCost = costTracker.getTotalCost();
    const periodInfo = costTracker.getPeriodInfo();

    // Build model breakdowns from in-memory data
    const modelBreakdowns = Array.from(modelCosts.entries())
      .map(([model, data]) => ({
        model,
        ...data,
      }))
      .sort((a, b) => b.cost - a.cost);

    // Calculate aggregate cache token counts
    let totalCacheWriteTokens = 0;
    let totalCacheReadTokens = 0;

    for (const data of modelCosts.values()) {
      totalCacheWriteTokens += data.cacheWriteTokens;
      totalCacheReadTokens += data.cacheReadTokens;
    }
    const totalCacheTokens = totalCacheWriteTokens + totalCacheReadTokens;

    // Calculate cache savings for display
    let totalCacheSavingsAmount = 0;
    let totalCostWithoutCaching = 0;

    for (const modelData of modelBreakdowns) {
      try {
        const model = modelService.getLlmModel(modelData.model);

        const cacheSavings = calculateModelCacheSavings(modelData, model);
        if (cacheSavings) {
          totalCacheSavingsAmount += cacheSavings.savingsAmount;
          totalCostWithoutCaching += cacheSavings.costWithoutCaching;
        } else {
          totalCostWithoutCaching += modelData.cost || 0;
        }
      } catch {
        totalCostWithoutCaching += modelData.cost || 0;
      }
    }

    const spendLimit =
      agentConfig().spendLimitDollars || globalConfig().spendLimitDollars;
    const spendLimitHours =
      agentConfig().spendLimitHours || globalConfig().spendLimitHours;

    // Show period information if time-based limits are enabled
    if (periodInfo && spendLimitHours !== undefined) {
      const formatTime = (date: Date) => {
        return date.toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
        });
      };
      output.comment(
        `Current period: ${formatTime(periodInfo.periodStart)} - ${formatTime(periodInfo.periodEnd)} (${spendLimitHours} hour${spendLimitHours !== 1 ? "s" : ""})`,
      );
      output.comment(
        `Period cost: $${periodInfo.periodCost.toFixed(2)} of $${spendLimit} limit`,
      );
    }

    output.comment(
      `Total cost: $${totalStoredCost.toFixed(2)}${spendLimitHours === undefined ? ` of $${spendLimit} limit` : ""}`,
    );

    // Calculate and display cache savings if caching was used
    if (totalCacheTokens > 0) {
      const savingsPercent =
        totalCostWithoutCaching > 0
          ? (totalCacheSavingsAmount / totalCostWithoutCaching) * 100
          : 0;

      output.comment(
        `Cache savings: $${totalCacheSavingsAmount.toFixed(4)} (${savingsPercent.toFixed(1)}% saved vs $${totalCostWithoutCaching.toFixed(4)} without caching)`,
      );
      output.comment(
        `Cache usage: ${totalCacheTokens.toLocaleString()} tokens (${totalCacheWriteTokens.toLocaleString()} write, ${totalCacheReadTokens.toLocaleString()} read)`,
      );
    }

    // Show detailed breakdown by model
    for (const modelData of modelBreakdowns) {
      let model;
      try {
        model = modelService.getLlmModel(modelData.model);
      } catch {
        output.comment(`  Non-model: ${modelData.model}`);
        output.comment(`    Total cost: $${(modelData.cost || 0).toFixed(4)}`);
        continue;
      }

      output.comment(
        `  ${model.label}: $${(modelData.cost || 0).toFixed(4)} total`,
      );

      // Show token breakdown
      const inputTokens = modelData.inputTokens || 0;
      const outputTokens = modelData.outputTokens || 0;
      const cacheWriteTokens = modelData.cacheWriteTokens || 0;
      const cacheReadTokens = modelData.cacheReadTokens || 0;

      if (inputTokens > 0) {
        const inputCost = (inputTokens * model.inputCost) / 1_000_000;
        output.comment(
          formatCostDetail("Input", inputCost, inputTokens, model.inputCost),
        );
      }

      if (outputTokens > 0) {
        const outputCost = (outputTokens * model.outputCost) / 1_000_000;
        output.comment(
          formatCostDetail(
            "Output",
            outputCost,
            outputTokens,
            model.outputCost,
          ),
        );
      }

      if (model.cacheWriteCost && cacheWriteTokens > 0) {
        const cacheWriteCost =
          (cacheWriteTokens * model.cacheWriteCost) / 1_000_000;
        output.comment(
          formatCostDetail(
            "Cache write",
            cacheWriteCost,
            cacheWriteTokens,
            model.cacheWriteCost,
          ),
        );
      }

      if (model.cacheReadCost && cacheReadTokens > 0) {
        const cacheReadCost =
          (cacheReadTokens * model.cacheReadCost) / 1_000_000;
        output.comment(
          formatCostDetail(
            "Cache read",
            cacheReadCost,
            cacheReadTokens,
            model.cacheReadCost,
          ),
        );
      }

      // Show cache savings for this model
      const cacheSavings = calculateModelCacheSavings(modelData, model);
      if (cacheSavings) {
        output.comment(
          `    Cache savings: $${cacheSavings.savingsAmount.toFixed(4)} (${cacheSavings.savingsPercent.toFixed(1)}% saved vs $${cacheSavings.costWithoutCaching.toFixed(4)} without caching)`,
        );
      }
    }
  }

  function calculateModelCacheSavings(
    modelData: {
      model: string;
      inputTokens: number;
      outputTokens: number;
      cacheWriteTokens: number;
      cacheReadTokens: number;
    },
    model: LlmModelCosts,
  ) {
    const cacheWriteTokens = modelData.cacheWriteTokens || 0;
    const cacheReadTokens = modelData.cacheReadTokens || 0;
    const totalCacheTokens = cacheWriteTokens + cacheReadTokens;

    if (totalCacheTokens === 0 || !model.inputCost) {
      return null;
    }

    // Calculate what these cache tokens would have cost at regular input rate
    const cacheSavingsAmount =
      (cacheWriteTokens * (model.inputCost - (model.cacheWriteCost || 0))) /
        1_000_000 +
      (cacheReadTokens * (model.inputCost - (model.cacheReadCost || 0))) /
        1_000_000;

    // Calculate actual cache cost from tokens
    const actualCacheSpend =
      (cacheWriteTokens * (model.cacheWriteCost || 0)) / 1_000_000 +
      (cacheReadTokens * (model.cacheReadCost || 0)) / 1_000_000;

    // Calculate total cost for this model from tokens
    const inputTokens = modelData.inputTokens || 0;
    const outputTokens = modelData.outputTokens || 0;
    const inputCost = (inputTokens * model.inputCost) / 1_000_000;
    const outputCost = (outputTokens * model.outputCost) / 1_000_000;
    const modelTotalCost = inputCost + outputCost + actualCacheSpend;

    const costWithoutCaching = modelTotalCost + cacheSavingsAmount;
    const savingsPercent =
      cacheSavingsAmount > 0
        ? (cacheSavingsAmount / costWithoutCaching) * 100
        : 0;

    return {
      savingsAmount: cacheSavingsAmount,
      costWithoutCaching,
      savingsPercent,
      totalCacheTokens,
      totalCost: modelTotalCost,
      inputCost,
      outputCost,
      actualCacheSpend,
    };
  }

  /** ns-cost [reset]: Show cost breakdown or reset cost tracking data */
  function handleCommand(cmdArgs: string): string {
    const argv = stringArgv(cmdArgs);
    const subcommand = argv[0];

    if (subcommand === "reset") {
      costTracker.resetCosts();
      return "Cost tracking data cleared.";
    } else if (subcommand) {
      return "The 'ns-cost' command only supports the 'reset' parameter.";
    } else {
      printCosts();
      return "";
    }
  }

  const registrableCommand: RegistrableCommand = {
    command: costCmd,
    handleCommand,
  };

  return {
    ...registrableCommand,
  };
}

export type CostDisplayService = ReturnType<typeof createCostDisplayService>;
