import { Tooltip } from "@mantine/core";
import type { AgentConfigFile } from "@naisys/common";
import { parseTemplateSegments } from "@naisys/common";
import React, { useMemo } from "react";

const SPECIAL_BUILTIN_VARS = new Set([
  "${env.NAISYS_API_KEY}",
  "${env.NAISYS_API_URL_BASE}",
]);

export const TemplatedText: React.FC<{
  template: string;
  config: AgentConfigFile;
  envVars?: Record<string, string>;
}> = ({ template, config, envVars }) => {
  const segments = useMemo(
    () =>
      parseTemplateSegments(template, {
        agent: config as Record<string, unknown>,
        ...(envVars ? { env: envVars as Record<string, unknown> } : {}),
      }),
    [template, config, envVars],
  );

  return (
    <>
      {segments.map((seg, i) => {
        if (seg.type === "text") {
          return <span key={i}>{seg.text}</span>;
        }

        if (SPECIAL_BUILTIN_VARS.has(seg.variable)) {
          return (
            <Tooltip key={i} label="Special built-in variable" withArrow>
              <span
                style={{
                  color: "var(--mantine-color-blue-4)",
                  cursor: "help",
                }}
              >
                {seg.variable}
              </span>
            </Tooltip>
          );
        }

        if (seg.value !== undefined) {
          return (
            <Tooltip key={i} label={seg.variable} withArrow>
              <span
                style={{ color: "var(--mantine-color-blue-4)", cursor: "help" }}
              >
                {seg.value}
              </span>
            </Tooltip>
          );
        }

        // Unresolved variable (e.g. env vars) — show raw
        return (
          <Tooltip key={i} label="Resolved at runtime" withArrow>
            <span
              style={{
                color: "var(--mantine-color-dimmed)",
                fontStyle: "italic",
                cursor: "help",
              }}
            >
              {seg.variable}
            </span>
          </Tooltip>
        );
      })}
    </>
  );
};
