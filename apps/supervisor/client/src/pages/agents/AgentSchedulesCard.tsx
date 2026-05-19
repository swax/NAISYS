import {
  Badge,
  Button,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconClock, IconClockPlay } from "@tabler/icons-react";
import React, { useCallback, useEffect, useState } from "react";

import {
  getAgentSchedules,
  triggerAgentSchedule,
} from "../../lib/api/apiAgents";
import type { ScheduleOverviewResponse } from "../../lib/api/apiClient";

interface AgentSchedulesCardProps {
  username: string;
  canTrigger: boolean;
}

function formatRelative(target: Date, now: Date): string {
  const ms = target.getTime() - now.getTime();
  if (ms < 0) {
    const ago = Math.round(-ms / 1000);
    if (ago < 60) return `${ago}s ago`;
    const m = Math.round(ago / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.round(m / 60);
    if (h < 48) return `${h}h ago`;
    const d = Math.round(h / 24);
    return `${d}d ago`;
  }
  const s = Math.round(ms / 1000);
  if (s < 60) return `in ${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `in ${m}m`;
  const h = Math.round(m / 60);
  if (h < 48) return `in ${h}h`;
  const d = Math.round(h / 24);
  return `in ${d}d`;
}

export const AgentSchedulesCard: React.FC<AgentSchedulesCardProps> = ({
  username,
  canTrigger,
}) => {
  const [data, setData] = useState<ScheduleOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await getAgentSchedules(username);
      setData(res);
    } catch (err) {
      console.error("Failed to load schedules:", err);
    } finally {
      setLoading(false);
    }
  }, [username]);

  useEffect(() => {
    void refresh();
    // Poll on the same cadence as the scheduler tick so a fire shows up
    // as "Last: <recent>" within ~30s without a manual reload.
    const handle = setInterval(() => void refresh(), 30_000);
    return () => clearInterval(handle);
  }, [refresh]);

  const handleTrigger = async (scheduleName: string) => {
    setTriggering(scheduleName);
    try {
      const result = await triggerAgentSchedule(username, scheduleName);
      notifications.show({
        title: result.success ? "Schedule fired" : "Trigger skipped",
        message: result.message,
        color: result.success ? "green" : "yellow",
      });
      await refresh();
    } catch (err) {
      notifications.show({
        title: "Trigger failed",
        message: err instanceof Error ? err.message : String(err),
        color: "red",
      });
    } finally {
      setTriggering(null);
    }
  };

  if (loading) {
    return (
      <Group gap="xs">
        <Loader size="xs" />
        <Text size="sm" c="dimmed">
          Loading schedules...
        </Text>
      </Group>
    );
  }

  if (!data || data.entries.length === 0) {
    return null;
  }

  const now = new Date();

  return (
    <Paper p="sm" withBorder>
      <Stack gap="xs">
        <Group gap="xs" align="center">
          <IconClock size={14} />
          <Text fw={600} size="sm">
            Schedules
          </Text>
        </Group>

        {data.entries.map((entry) => {
          const nextDate = entry.nextFireAt ? new Date(entry.nextFireAt) : null;
          const lastDate = entry.lastFireAt ? new Date(entry.lastFireAt) : null;
          return (
            <Stack
              key={entry.name}
              gap={4}
              p="xs"
              style={{
                borderTop: "1px solid var(--mantine-color-default-border)",
              }}
            >
              <Group gap="xs" wrap="wrap" align="center">
                <Text fw={600} size="sm">
                  {entry.name}
                </Text>
                {!entry.enabled && (
                  <Badge size="xs" color="gray">
                    Disabled
                  </Badge>
                )}
                <Text size="xs" c="dimmed" style={{ fontFamily: "monospace" }}>
                  {entry.cron}
                </Text>
                {canTrigger && entry.enabled && (
                  <Button
                    ml="auto"
                    size="compact-xs"
                    variant="light"
                    leftSection={<IconClockPlay size={12} />}
                    loading={triggering === entry.name}
                    onClick={() => handleTrigger(entry.name)}
                  >
                    Trigger now
                  </Button>
                )}
              </Group>
              {entry.prompt && (
                <Text size="xs" c="dimmed" lineClamp={2}>
                  {entry.prompt}
                </Text>
              )}
              <Group gap="md" wrap="wrap">
                {nextDate && (
                  <Text size="xs" c="dimmed">
                    Next: {nextDate.toLocaleString()} (
                    {formatRelative(nextDate, now)})
                  </Text>
                )}
                {lastDate && (
                  <Text size="xs" c="dimmed">
                    Last: {lastDate.toLocaleString()} (
                    {formatRelative(lastDate, now)})
                  </Text>
                )}
                {!lastDate && (
                  <Text size="xs" c="dimmed">
                    Last: never
                  </Text>
                )}
              </Group>
            </Stack>
          );
        })}
      </Stack>
    </Paper>
  );
};
