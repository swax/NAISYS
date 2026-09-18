# September 2026 model refresh

Verified on September 18, 2026 against official documentation and live API
requests using the local NAISYS configuration.

| NAISYS key        | API model                | Input / output USD per million tokens |
| ----------------- | ------------------------ | ------------------------------------- |
| `gpt_astra` (new) | `gpt-6-astra`            | 10 / 50                               |
| `gpt_sol`         | `gpt-5.6-sol`            | 4 / 20                                |
| `gpt_terra` (new) | `gpt-5.6-terra`          | 2 / 12                                |
| `gpt_luna` (new)  | `gpt-5.6-luna`           | 0.20 / 1.20                           |
| `claude_opus`     | `claude-opus-5`          | 5 / 25                                |
| `claude_sonnet`   | `claude-sonnet-5`        | 2 / 10                                |
| `claude_haiku`    | `claude-haiku-4-5`       | 1 / 5                                 |
| `grok`            | `grok-4.6`               | 2 / 6                                 |
| `grok_fast`       | `grok-4.3`               | 1.25 / 2.50                           |
| `gemini_pro`      | `gemini-3.1-pro-preview` | 2 / 12                                |
| `gemini_flash`    | `gemini-3.8-flash`       | 0.75 / 3.75                           |

Sources: [OpenAI pricing](https://developers.openai.com/api/docs/pricing),
[Claude models](https://platform.claude.com/docs/en/models/overview),
[Grok 4.6](https://docs.x.ai/developers/models/grok-4.6),
[Grok 4.3](https://docs.x.ai/developers/models/grok-4.3), and
[Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing).

These are standard short-context rates. The existing flat-rate cost estimator
does not model long-context premiums, processing tiers, or cache storage charges.
Gemini 3.8 Flash introductory prices double on January 1, 2027; refresh the catalog
then. Sol pricing is promotional at least through November 21, 2026.

Compatibility aliases preserve names that existed before this refresh. The inexpensive `gpt_mini` and `gpt_nano` models remain available at their previous prices; Terra and Luna have separate keys. User-customized database models continue to override built-ins.

The legacy `gemini2pro` entry is now correctly labeled Gemini 2.5 Computer Use,
with its API-reported 131,072 input-token limit and text/image input capabilities.
Its introductory input/output rates are 1 / 5 through December 31, 2026.

## Adapter compatibility

- Current Claude models use adaptive thinking with `output_config.effort`.
  Haiku retains manual thinking budgets. Empty responses surface the provider's
  stop reason instead of silently returning an empty command.
- Claude computer-use requests select the compatible beta tool version,
  including the older version required by Haiku 4.5 and Sonnet 4.5.
- Gemini 3 uses thinking levels; Gemini 2.5 keeps token budgets. Hidden thinking
  tokens are included in output cost.
- OpenAI cache writes are recorded separately from ordinary and cached input.

## Local validation

All eleven models in the table passed both a text response and a
`submit_commands` call through NAISYS's compiled adapters. The test checks returned
commands without executing them. All four provider keys worked after replacing
the stale Gemini key in `apps/naisys/.env` with the working root `.env` copy.

Fable 5.1 passed text generation but returned `stop_reason: refusal` with empty
content for the synthetic command-tool request. It was omitted from the built-in
catalog pending successful tool validation.

Re-run the billable checks after building:

```powershell
npm run build
node scripts/test-models.mjs
# Optional: --env path/to/.env --models gpt_astra,claude_opus,gemini_flash

# OpenRouter: live catalog metadata, existing OpenAI-compatible adapter
node scripts/test-models.mjs --openrouter
# Optional: --models anthropic/claude-opus-5,google/gemini-3.8-flash
```

OpenRouter's existing root `.env` key authenticated successfully and reported
approximately $18.06 of available credits before testing. It was copied to the
local app environment and saved as a sensitive variable in the isolated local
review instance, without exporting it to agent shells. No new key was needed.

All four OpenRouter routes passed both text and `submit_commands` checks:
`openai/gpt-6-astra`, `anthropic/claude-opus-5`, `x-ai/grok-4.6`, and
`google/gemini-3.8-flash`. The eight requests had an estimated token cost of
$0.012269. The local Supervisor's existing **Add OpenRouter Model** catalog also
returned all four models with tool support; it fetches current metadata directly
from OpenRouter, so no hardcoded catalog additions were necessary.

The full build, 75 provider/context/computer-helper regression tests, and the
Supervisor admin integration test passed. The integration test's archive,
unarchive, and reset-spend calls now send the empty JSON bodies required by
their routes. On this Windows machine, Prisma database initialization succeeded
with `$env:RUST_LOG='info'`; without it, fresh migrations returned an empty
schema-engine error.

The isolated local review instance uses `.test-naisys/model-update` and serves
Supervisor and ERP at `http://localhost:3300`. Its HATEOAS model API was checked
against all 22 built-in LLM records, including prices and capability fields.
The production server was not modified.

## Versionless names and compatibility

NAISYS keys and labels identify a family; `versionName` remains the exact provider
model ID and is visible in Supervisor. Catalog upgrades change that ID deliberately;
there is no automatic lookup or silent selection of a newly released model.

| Canonical key                                         | Compatibility alias                                             |
| ----------------------------------------------------- | --------------------------------------------------------------- |
| `claude_opus`, `claude_sonnet`, `claude_haiku`        | `claude4opus`, `claude4sonnet`, `claude4haiku` respectively     |
| `gpt_sol`                                             | `gpt5`                                                          |
| `gpt_mini`, `gpt_nano`                                | `gpt5mini`, `gpt5nano` respectively                             |
| `grok`, `grok_fast`                                   | `grok4`, `grok4fast` respectively                               |
| `gemini_pro`, `gemini_flash`, `gemini_computer_use`   | `gemini3pro`, `gemini3flash`, `gemini2pro` respectively         |
| `gpt_image_high`, `gpt_image_medium`, `gpt_image_low` | `gptimage1high`, `gptimage1medium`, `gptimage1low` respectively |
| `dalle_1024_hd`, `dalle_1024`                         | `dalle3-1024-HD`, `dalle3-1024` respectively                    |
| `gpt_realtime`                                        | `gpt-realtime-2`                                                |

Astra, Terra, and Luna were introduced in this refresh: their temporary draft keys
`gpt6`, `gpt56terra`, and `gpt56luna` are not compatibility aliases. Only the
isolated local review database needed those draft rows renamed. New installations
seed the final keys directly. `none`, `mock`, and `lmstudio` are unchanged.

LLM and image models support an optional `aliases` list in YAML, the Supervisor API,
and the model editor. Aliases resolve directly to one canonical model, including
existing configurations and model URLs. Duplicate or conflicting names are rejected
across LLM and image models. Built-in compatibility aliases survive edits and resets.

On startup, old built-in rows migrate to canonical keys. Customized settings and
row identity are preserved; agent configurations and cost history are not rewritten.
If both names have custom definitions, migration stops without discarding either.
Standalone YAML overrides using old keys are normalized in memory. Customized
provider IDs stay pinned, including an old OAuth ID; reset the override to opt into
the current catalog version.

OpenRouter imports suggest names such as `openrouter_claude_opus` and
`openrouter_gpt_astra`, while retaining the full provider route as `versionName`.
The key is editable. Unknown models retain a provider-qualified suggestion;
existing imports are untouched. Importing with an existing name is rejected in
the dialog so a selection cannot accidentally overwrite another route.

Realtime uses `gpt_realtime` for the current `gpt-realtime-2` model, including
`VOICE_AGENT_MODEL` resolution. The older `gpt-realtime` remains a separate,
clearly labeled legacy choice with its original pricing.

## OAuth validation

The user's local browser sign-in was tested through the running hub and NAISYS's
OAuth adapter. The hub remains the single owner of refresh-token rotation.

| Key                       | Provider ID     | Result                     | Compatibility alias |
| ------------------------- | --------------- | -------------------------- | ------------------- |
| `gpt_astra_oauth`         | `gpt-6-astra`   | Text + command tool passed | None                |
| `gpt_sol_oauth`           | `gpt-5.6-sol`   | Text + command tool passed | `gpt52oauth`        |
| `gpt_terra_oauth`         | `gpt-5.6-terra` | Text + command tool passed | `gpt5oauth`         |
| `gpt_luna_oauth`          | `gpt-5.6-luna`  | Text + command tool passed | `gpt54minioauth`    |
| `gpt55oauth` (legacy pin) | `gpt-5.5`       | Text + command tool passed | None                |

GPT-5.4, GPT-5.4 Mini, and GPT-5.2 returned HTTP 400 through OAuth. Their old keys
now resolve to supported replacements as shown above. This changes the provider
version for default entries; customized overrides are preserved.

The [Codex model documentation](https://learn.chatgpt.com/docs/models) lists Terra
and Luna as the replacements for GPT-5.4 and GPT-5.4 Mini, and schedules GPT-5.5
OAuth retirement for October 14, 2026. Sol is our replacement for the retired
GPT-5.2 entry. The new OAuth entries use the Codex catalog's default 272,000-token
context window, separate from the larger API-key limits.

Re-run against the signed-in local instance:

```powershell
node scripts/test-models.mjs --oauth --local-folder .test-naisys/model-update
# Optional: --models gpt_astra_oauth,gpt_luna_oauth --hub-url http://localhost:3300
```

The complete build and 83 focused tests passed: model naming and aliases,
persisted migration, OAuth usage limits, runtime/provider adapters, voice model
resolution, and the Supervisor admin API (including image aliases). Local startup
produced exactly 22 LLM and 5 image records with the expected aliases and retained
the OAuth login. Image generation and live voice audio were not exercised by
these naming tests.

Browser checks confirmed that an old image-model URL opens its canonical entry,
the image alias editor is populated, and the OpenRouter importer suggests
`openrouter_gpt_astra` and blocks an existing key. All five final OAuth catalog
entries passed text and command-tool requests again after the local restart.
