import { Anchor, Group, Paper, Stack, Text } from "@mantine/core";
import type { DashboardSchedule } from "@naisys/supervisor-shared";
import { IconClock } from "@tabler/icons-react";
import React from "react";
import { Link } from "react-router-dom";

import { formatUntil } from "../dashboardFormat";

export const UpcomingSchedulesPanel: React.FC<{
  schedules: DashboardSchedule[];
}> = ({ schedules }) => (
  <Paper p="md" withBorder>
    <Group gap={8} mb="sm">
      <IconClock size={18} />
      <Text fw={600}>Upcoming scheduled runs</Text>
    </Group>
    {schedules.length === 0 ? (
      <Text size="sm" c="dimmed">
        Nothing scheduled.
      </Text>
    ) : (
      <Stack gap={8}>
        {schedules.map((s) => (
          <Group key={s.username} justify="space-between" wrap="nowrap">
            <Anchor
              component={Link}
              to={`/agents/${s.username}`}
              size="sm"
              fw={500}
              truncate
            >
              {s.username}
            </Anchor>
            <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
              {formatUntil(s.nextRunAt)}
            </Text>
          </Group>
        ))}
      </Stack>
    )}
  </Paper>
);
