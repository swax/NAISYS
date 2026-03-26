Access the NAISYS REST API (supervisor, ERP) using configured API keys.

IMPORTANT: Never read .env.ns-api with the Read tool — that exposes API keys.
Always source it inline with bash commands.

All curl commands follow this pattern — just pick the right key and go:
source .claude/commands/.env.ns-api && curl -sS -H "x-api-key: $NS_ADMIN_API_KEY" "$NS_API_URL/<path>" | jq

If the user specifies a role (e.g. "planner"), use the matching key variable
(e.g. $NS_PLANNER_API_KEY). If no role is specified, use the first available key.
Do NOT run preliminary commands to check what keys exist — just use the key
and if it fails, then troubleshoot.

If the curl fails because .env.ns-api is missing or the key is empty, tell the user:
"Copy .claude/commands/.env.ns-api.example to .claude/commands/.env.ns-api and add your API key from the User Details page."

The API has two HATEOAS entry points:

- $NS_API_URL/supervisor/ — agent management, hosts, models, variables, permissions
- $NS_API_URL/erp/ — ERP system

Start at the appropriate entry point and follow \_links and \_actions to discover
endpoints. Do NOT fetch the entry point first if you can infer the path from
the \_links structure (e.g. agents are at $NS_API_URL/supervisor/agents).
Use GET to explore, POST/PUT/DELETE for mutations.

User's request: $ARGUMENTS
