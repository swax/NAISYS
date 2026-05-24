import { Anchor, Group, Paper, Stack, Text } from "@mantine/core";
import type { DashboardMessage } from "@naisys/supervisor-shared";
import { IconMessages } from "@tabler/icons-react";
import React from "react";
import { Link } from "react-router-dom";

import { formatRelative } from "../dashboardFormat";

export const RecentMessagesPanel: React.FC<{
  messages: DashboardMessage[];
}> = ({ messages }) => (
  <Paper p="md" withBorder>
    <Group gap={8} mb="sm">
      <IconMessages size={18} />
      <Text fw={600}>Latest messages</Text>
    </Group>
    {messages.length === 0 ? (
      <Text size="sm" c="dimmed">
        No messages yet.
      </Text>
    ) : (
      <Stack gap={10}>
        {messages.map((m) => (
          <div key={m.id}>
            <Group justify="space-between" wrap="nowrap" gap="xs">
              <Anchor
                component={Link}
                to={`/agents/${m.fromUsername}/${m.kind}`}
                size="sm"
                fw={500}
                truncate
                style={{ minWidth: 0 }}
              >
                {m.fromTitle}
              </Anchor>
              <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
                {formatRelative(m.createdAt)}
              </Text>
            </Group>
            <Text size="xs" c="dimmed" truncate>
              {m.subject ? `${m.subject} — ` : ""}
              {m.snippet}
            </Text>
          </div>
        ))}
      </Stack>
    )}
  </Paper>
);
