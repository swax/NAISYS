import { Anchor, Group, Paper, Stack, Text } from "@mantine/core";
import type { DashboardErrorRun } from "@naisys/supervisor-shared";
import { IconAlertTriangle } from "@tabler/icons-react";
import React from "react";
import { Link } from "react-router-dom";

import { formatRelative } from "../dashboardFormat";

export const LatestErrorsPanel: React.FC<{
  errorRuns: DashboardErrorRun[];
}> = ({ errorRuns }) => (
  <Paper p="md" withBorder>
    <Group gap={8} mb="sm">
      <IconAlertTriangle size={18} />
      <Text fw={600}>Latest errors</Text>
    </Group>
    {errorRuns.length === 0 ? (
      <Text size="sm" c="dimmed">
        No recent errors.
      </Text>
    ) : (
      <Stack gap={8}>
        {errorRuns.map((e) => (
          <Group
            key={`${e.username}-${e.runId}`}
            justify="space-between"
            wrap="nowrap"
            gap="xs"
          >
            <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
              <Anchor
                component={Link}
                to={`/agents/${e.username}/runs/${e.runId}/sessions/${e.sessionId}`}
                size="sm"
                fw={500}
                truncate
              >
                {e.title}
              </Anchor>
              <Text size="xs" c="dimmed" truncate>
                {e.errorCount} error{e.errorCount === 1 ? "" : "s"} in run{" "}
                {e.runId}
              </Text>
            </Group>
            <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
              {formatRelative(e.lastErrorAt)}
            </Text>
          </Group>
        ))}
      </Stack>
    )}
  </Paper>
);
