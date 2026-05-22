import { Anchor, Box, Group, Paper, Stack, Text } from "@mantine/core";
import type { DashboardHost } from "@naisys/supervisor-shared";
import { IconServer } from "@tabler/icons-react";
import React from "react";
import { Link } from "react-router-dom";

import { PlatformBadge } from "../../../components/badges/PlatformBadge";

export const HostHealthPanel: React.FC<{ hosts: DashboardHost[] }> = ({
  hosts,
}) => {
  const onlineHosts = hosts.filter((h) => h.online);
  const offlineCount = hosts.length - onlineHosts.length;

  return (
    <Paper p="md" withBorder>
      <Group gap={8} mb="sm">
        <IconServer size={18} />
        <Text fw={600}>Host health</Text>
      </Group>
      {hosts.length === 0 ? (
        <Text size="sm" c="dimmed">
          No hosts registered.
        </Text>
      ) : (
        <Stack gap={8}>
          {onlineHosts.map((h) => (
            <Group key={h.name} justify="space-between" wrap="nowrap" gap="xs">
              <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
                <Box
                  w={8}
                  h={8}
                  bg="green.6"
                  style={{ borderRadius: "50%", flexShrink: 0 }}
                />
                <Anchor
                  component={Link}
                  to={`/hosts/${h.name}`}
                  size="sm"
                  fw={500}
                  truncate
                >
                  {h.name}
                </Anchor>
                <PlatformBadge platform={h.platform} />
                <Text size="xs" c="dimmed" truncate>
                  {h.hostType}
                </Text>
              </Group>
              <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
                {h.agentCount} agent{h.agentCount === 1 ? "" : "s"}
              </Text>
            </Group>
          ))}
          {onlineHosts.length === 0 && (
            <Text size="sm" c="dimmed">
              No hosts online.
            </Text>
          )}
          {offlineCount > 0 && (
            <Text size="xs" c="dimmed">
              {offlineCount} offline
            </Text>
          )}
        </Stack>
      )}
    </Paper>
  );
};
