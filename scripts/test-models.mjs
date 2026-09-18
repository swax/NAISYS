#!/usr/bin/env node
/** Opt-in, billable smoke tests through NAISYS's actual provider adapters.
 * Build first, then: node scripts/test-models.mjs [--env path] [--models key,key]
 * Add --openrouter to test OpenRouter model IDs from its live catalog instead.
 * Add --oauth --local-folder path to test the running local hub's OAuth login.
 * Only synthetic prompts are sent. Returned commands are checked, never executed.
 */
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { builtInLlmModels, findLlmModel, LlmApiType } from "@naisys/common";
import { HubEvents } from "@naisys/hub-protocol";
import dotenv from "dotenv";
import { io } from "socket.io-client";

import { createCommandTools } from "../apps/naisys/dist/llm/commandTool.js";
import { sendWithAnthropic } from "../apps/naisys/dist/llm/vendors/anthropic.js";
import { sendWithGoogle } from "../apps/naisys/dist/llm/vendors/google.js";
import { sendWithOpenAiCompatible } from "../apps/naisys/dist/llm/vendors/openai-compatible.js";
import { sendWithOpenAiStandard } from "../apps/naisys/dist/llm/vendors/openai-standard.js";
import { sendWithOpenAiOauth } from "../apps/naisys/dist/llm/vendors/openai-oauth.js";

const { values } = parseArgs({
  options: {
    env: { type: "string" },
    models: { type: "string" },
    openrouter: { type: "boolean", default: false },
    oauth: { type: "boolean", default: false },
    "local-folder": { type: "string" },
    "hub-url": { type: "string", default: "http://localhost:3300" },
  },
});
if (values.oauth && (values.openrouter || !values["local-folder"])) {
  throw new Error(
    "--oauth requires --local-folder and cannot be combined with --openrouter",
  );
}
const envPath = resolve(values.env ?? "apps/naisys/.env");
const variables = { ...dotenv.parse(readFileSync(envPath)), ...process.env };
const keys = (
  values.models ??
  (values.openrouter
    ? "openai/gpt-6-astra,anthropic/claude-opus-5,x-ai/grok-4.6,google/gemini-3.8-flash"
    : values.oauth
      ? "gpt_astra_oauth,gpt_sol_oauth,gpt_terra_oauth,gpt_luna_oauth,gpt55oauth"
      : "gpt_astra,gpt_sol,gpt_terra,gpt_luna,claude_opus,claude_sonnet,claude_haiku,grok,grok_fast,gemini_pro,gemini_flash")
).split(",");
const senders = {
  [LlmApiType.OpenAI]: sendWithOpenAiStandard,
  [LlmApiType.Anthropic]: sendWithAnthropic,
  [LlmApiType.Google]: sendWithGoogle,
  [LlmApiType.OpenAICompatible]: sendWithOpenAiCompatible,
  // OAuth's adapter obtains credentials from deps, not the API-key argument.
  [LlmApiType.OpenAIOAuth]: (
    deps,
    key,
    system,
    context,
    source,
    _apiKey,
    signal,
  ) => sendWithOpenAiOauth(deps, key, system, context, source, signal),
};
const tools = createCommandTools({
  agentConfig: () => ({ multipleCommandsEnabled: false }),
});
const secrets = Object.entries(variables)
  .filter(
    ([name, value]) => /(?:KEY|TOKEN|SECRET|PASSWORD)/i.test(name) && value,
  )
  .map(([, value]) => value);
function redact(error) {
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of secrets)
    message = message.replaceAll(secret, "[REDACTED]");
  return message.slice(0, 600);
}

let socket;
let getCodexAccessToken;
if (values.oauth) {
  try {
    const accessKey = readFileSync(
      resolve(values["local-folder"], "cert/integrated-supervisor-access-key"),
      "utf8",
    ).trim();
    secrets.push(accessKey);
    const { version: clientVersion } = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    );
    socket = io(values["hub-url"], {
      path: "/hub/socket.io",
      auth: {
        accessKey,
        instanceId: randomUUID(),
        startedAt: Date.now(),
        clientVersion,
      },
      reconnection: false,
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Local hub connection timed out")),
        15000,
      );
      socket.once("connect", () => {
        clearTimeout(timer);
        resolve();
      });
      socket.once("connect_error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    // The running hub owns refresh-token rotation. Never rotate a copied token.
    getCodexAccessToken = async (forceRefresh = false) => {
      const result = await socket
        .timeout(30000)
        .emitWithAck(HubEvents.CODEX_ACCESS_TOKEN_GET, { forceRefresh });
      if (!result.success || !result.accessToken)
        throw new Error(
          result.error ??
            "Sign in to Codex OAuth in the local Supervisor first.",
        );
      secrets.push(result.accessToken);
      return result.accessToken;
    };
  } catch (error) {
    socket?.disconnect();
    console.error(redact(error));
    process.exit(1);
  }
}

let models = builtInLlmModels;
if (values.openrouter) {
  if (!variables.OPENROUTER_API_KEY) {
    console.error("Missing OPENROUTER_API_KEY in the selected environment.");
    process.exit(1);
  }
  try {
    const response = await fetch("https://openrouter.ai/api/v1/models", {
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok)
      throw new Error(`OpenRouter catalog returned HTTP ${response.status}`);
    const catalog = await response.json();
    models = catalog.data.map((model) => ({
      key: model.id,
      label: model.name,
      versionName: model.id,
      apiType: LlmApiType.OpenAICompatible,
      apiKeyVar: "OPENROUTER_API_KEY",
      baseUrl: "https://openrouter.ai/api/v1",
      maxTokens: model.context_length,
      inputCost: Number(model.pricing.prompt) * 1_000_000,
      outputCost: Number(model.pricing.completion) * 1_000_000,
      cacheReadCost:
        model.pricing.input_cache_read === undefined
          ? undefined
          : Number(model.pricing.input_cache_read) * 1_000_000,
      cacheWriteCost:
        model.pricing.input_cache_write === undefined
          ? undefined
          : Number(model.pricing.input_cache_write) * 1_000_000,
      supportsToolUse: model.supported_parameters?.includes("tools") === true,
    }));
  } catch (error) {
    console.error(redact(error));
    process.exit(1);
  }
}

let failed = 0;
let totalCost = 0;
console.log(
  `Testing ${keys.length} models using ${envPath}. No commands will be executed.`,
);
for (const key of keys) {
  const model = findLlmModel(models, key);
  if (
    !model ||
    !senders[model.apiType] ||
    (model.apiType === LlmApiType.OpenAIOAuth
      ? !getCodexAccessToken
      : !variables[model.apiKeyVar])
  ) {
    console.log(
      JSON.stringify({
        key,
        status: "FAIL",
        error: "Unknown model, unsupported adapter, or missing API key",
      }),
    );
    failed++;
    continue;
  }
  const started = Date.now();
  const usage = [];
  const deps = {
    modelService: { getLlmModel: () => model },
    costTracker: { recordTokens: (...args) => usage.push(args) },
    tools,
    useToolsForLlmConsoleResponses: true,
    getCodexAccessToken,
  };
  try {
    for (const mode of ["text", "tool"]) {
      const result = await senders[model.apiType](
        deps,
        key,
        "This is a connectivity test. Follow the user's requested output exactly.",
        [
          {
            role: "user",
            content:
              mode === "text"
                ? "Reply with exactly OK."
                : 'Call submit_commands once with command "echo NAISYS_MODEL_OK" and an empty comment. Do not run anything or return other text.',
          },
        ],
        mode === "text" ? "compact" : "console",
        variables[model.apiKeyVar],
        AbortSignal.timeout(60000),
      );
      const expected = mode === "text" ? "OK" : "echo NAISYS_MODEL_OK";
      if (
        result.responses.join("\n").trim() !== expected ||
        result.messagesTokenCount <= 0
      ) {
        throw new Error(
          `${mode} response did not match the smoke-test contract: ${JSON.stringify(result.responses).slice(0, 400)}`,
        );
      }
    }
    console.log(
      JSON.stringify({
        key,
        model: model.versionName,
        status: "PASS",
        text: true,
        tool: true,
        milliseconds: Date.now() - started,
      }),
    );
  } catch (error) {
    failed++;
    console.log(
      JSON.stringify({
        key,
        model: model.versionName,
        status: "FAIL",
        error: redact(error),
      }),
    );
  }
  for (const [, , input, output, writes, reads] of usage) {
    totalCost +=
      (input * model.inputCost +
        output * model.outputCost +
        writes * (model.cacheWriteCost ?? model.inputCost) +
        reads * (model.cacheReadCost ?? model.inputCost)) /
      1_000_000;
  }
}
socket?.disconnect();
console.log(
  JSON.stringify({
    tested: keys.length,
    passed: keys.length - failed,
    failed,
    estimatedCostUsd: Number(totalCost.toFixed(6)),
  }),
);
process.exitCode = failed ? 1 : 0;
