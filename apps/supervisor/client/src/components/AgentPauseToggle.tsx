import { ActionIcon, Tooltip } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconPlayerPauseFilled } from "@tabler/icons-react";
import React, { useState } from "react";

import { pauseRun, resumeRun } from "../lib/apiRuns";

interface AgentPauseToggleProps {
  username: string;
  runId: number;
  sessionId: number;
  subagentId?: number | null;
  paused: boolean;
  /** Called after a successful pause/resume so the caller can patch its cache. */
  onPauseChanged: (paused: boolean) => void;
  /** Override the tooltip + aria label. Defaults to "Pause/Resume agent". */
  tooltipLabel?: (paused: boolean) => string;
}

export const AgentPauseToggle: React.FC<AgentPauseToggleProps> = ({
  username,
  runId,
  sessionId,
  subagentId,
  paused,
  onPauseChanged,
  tooltipLabel,
}) => {
  const [loading, setLoading] = useState(false);
  const label = tooltipLabel
    ? tooltipLabel(paused)
    : paused
      ? "Resume agent"
      : "Pause agent";

  const handleClick = async () => {
    const target = !paused;
    setLoading(true);
    try {
      const result = target
        ? await pauseRun(username, runId, sessionId, subagentId)
        : await resumeRun(username, runId, sessionId, subagentId);
      if (result.success) {
        onPauseChanged(target);
      } else {
        notifications.show({
          title: target ? "Pause Failed" : "Resume Failed",
          message: result.message,
          color: "red",
        });
      }
    } catch (err) {
      notifications.show({
        title: target ? "Pause Failed" : "Resume Failed",
        message: err instanceof Error ? err.message : "Unknown error",
        color: "red",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Tooltip label={label}>
      <ActionIcon
        variant="subtle"
        color={paused ? "orange" : "gray"}
        size="lg"
        loading={loading}
        onClick={() => void handleClick()}
        aria-label={label}
      >
        <IconPlayerPauseFilled size={18} />
      </ActionIcon>
    </Tooltip>
  );
};
