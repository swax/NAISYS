import { Anchor, Badge, Box, Group, Paper, Stack, Text } from "@mantine/core";
import { useElementSize } from "@mantine/hooks";
import { formatTokens } from "@naisys/common";
import type { DashboardRun } from "@naisys/supervisor-shared";
import { IconActivity } from "@tabler/icons-react";
import React from "react";
import { Link } from "react-router-dom";

import { getApiTypeBadgeColor } from "../../../components/badges/ApiTypeBadge";
import { getPlatformBadgeColor } from "../../../components/badges/PlatformBadge";
import { useHostDataContext } from "../../../contexts/HostDataContext";
import { useLlmModels } from "../../../hooks/useLlmModels";
import { formatCost, formatRelative } from "../dashboardFormat";

const BADGE_HIDE_WIDTH = 480;

export const RecentRunsPanel: React.FC<{ runs: DashboardRun[] }> = ({
  runs,
}) => {
  const llmModels = useLlmModels();
  const { hosts } = useHostDataContext();
  const { ref, width } = useElementSize();
  const showBadges = width === 0 || width >= BADGE_HIDE_WIDTH;

  return (
    <Paper ref={ref} p="md" withBorder>
      <Group gap={8} mb="sm">
        <IconActivity size={18} />
        <Text fw={600}>Recent agent runs</Text>
      </Group>
      {runs.length === 0 ? (
        <Text size="sm" c="dimmed">
          No agent runs yet.
        </Text>
      ) : (
        <Stack gap={8}>
          {runs.map((run) => {
            const apiType = llmModels.find(
              (m) => m.key === run.modelName,
            )?.apiType;
            const platform = hosts.find(
              (h) => h.name === run.hostName,
            )?.platform;
            return (
              <Group
                key={`${run.username}-${run.runId}-${run.sessionId}`}
                justify="space-between"
                wrap="nowrap"
                gap="xs"
              >
                <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
                  <Box
                    w={8}
                    h={8}
                    bg={run.isOnline ? "green.6" : "dark.4"}
                    style={{ borderRadius: "50%", flexShrink: 0 }}
                  />
                  <Anchor
                    component={Link}
                    to={`/agents/${run.username}/runs/${run.runId}/sessions/${run.sessionId}`}
                    size="sm"
                    fw={500}
                    truncate
                  >
                    {run.title}
                  </Anchor>
                  {showBadges && (
                    <>
                      <Badge
                        size="xs"
                        variant="light"
                        color={getApiTypeBadgeColor(apiType)}
                        style={{ flexShrink: 0 }}
                      >
                        {run.modelName}
                      </Badge>
                      {run.hostName && (
                        <Badge
                          size="xs"
                          variant="light"
                          color={getPlatformBadgeColor(platform)}
                          style={{ flexShrink: 0 }}
                        >
                          {run.hostName}
                        </Badge>
                      )}
                    </>
                  )}
                </Group>
                <Group gap="md" wrap="nowrap" style={{ flexShrink: 0 }}>
                  <Text size="xs" c="dimmed">
                    {formatTokens(run.totalTokens)}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {formatCost(run.totalCost)}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {formatRelative(run.lastActive)}
                  </Text>
                </Group>
              </Group>
            );
          })}
        </Stack>
      )}
    </Paper>
  );
};
