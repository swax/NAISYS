import { Alert, Anchor, Stack, Text } from "@mantine/core";
import type { DashboardSuspendedAgent } from "@naisys/supervisor-shared";
import { IconAlertTriangle } from "@tabler/icons-react";
import React from "react";
import { Link } from "react-router-dom";

/** Amber alert for agents stopped by their spend limit; hidden when none. */
export const SuspendedAgentsAlert: React.FC<{
  agents: DashboardSuspendedAgent[];
}> = ({ agents }) => {
  if (agents.length === 0) return null;

  return (
    <Alert
      color="orange"
      icon={<IconAlertTriangle size={18} />}
      title={`${agents.length} agent${
        agents.length === 1 ? "" : "s"
      } suspended on spend limit`}
    >
      <Stack gap={4}>
        {agents.map((a) => (
          <Text key={a.username} size="sm">
            <Anchor component={Link} to={`/agents/${a.username}`} fw={600}>
              {a.username}
            </Anchor>{" "}
            — {a.reason}
          </Text>
        ))}
      </Stack>
    </Alert>
  );
};
