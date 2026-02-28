import {
  Anchor,
  Badge,
  Code,
  Group,
  Spoiler,
  Stack,
  Table,
  Text,
} from "@mantine/core";
import { AgentDetailResponse } from "@naisys-supervisor/shared";
import React from "react";
import { Link } from "react-router-dom";

import { Agent, Host } from "../../types/agent";

export const ConfigSummary: React.FC<{
  config: AgentDetailResponse["config"];
  leadUsername?: string;
  assignedHosts?: { id: number; name: string }[];
  hosts?: Host[];
  agents?: Agent[];
}> = ({ config, leadUsername, assignedHosts, hosts, agents }) => {
  const features: string[] = [];
  if (config.mailEnabled) features.push("Mail");
  if (config.chatEnabled) features.push("Chat");
  if (config.webEnabled) features.push("Web");
  if (config.completeSessionEnabled) features.push("Complete Session");
  if (config.wakeOnMessage) features.push("Wake On Message");
  if (config.workspacesEnabled) features.push("Workspaces");
  if (config.multipleCommandsEnabled) features.push("Multiple Commands");

  return (
    <Stack gap="sm">
      <Table withRowBorders={false}>
        <Table.Tbody>
          {config.title && (
            <Table.Tr>
              <Table.Td c="dimmed">Title</Table.Td>
              <Table.Td>{config.title}</Table.Td>
            </Table.Tr>
          )}
          {leadUsername && (
            <Table.Tr>
              <Table.Td c="dimmed">Lead Agent</Table.Td>
              <Table.Td>
                {(() => {
                  const leadAgent = agents?.find(
                    (a) => a.name === leadUsername,
                  );
                  return leadAgent ? (
                    <Anchor
                      component={Link}
                      to={`/agents/${leadAgent.id}`}
                      size="sm"
                    >
                      {leadUsername}
                    </Anchor>
                  ) : (
                    leadUsername
                  );
                })()}
              </Table.Td>
            </Table.Tr>
          )}
          <Table.Tr>
            <Table.Td c="dimmed">Assigned Hosts</Table.Td>
            <Table.Td>
              {assignedHosts && assignedHosts.length > 0 ? (
                <Group gap="sm">
                  {assignedHosts.map((h) => {
                    const hostData = hosts?.find((host) => host.id === h.id);
                    const isOnline = hostData?.online ?? false;
                    return (
                      <Group key={h.id} gap={4} wrap="nowrap">
                        <div
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: "50%",
                            backgroundColor: isOnline
                              ? "var(--mantine-color-green-6)"
                              : "var(--mantine-color-red-6)",
                            flexShrink: 0,
                          }}
                        />
                        <Anchor
                          component={Link}
                          to={`/hosts/${h.id}`}
                          size="sm"
                        >
                          {h.name}
                        </Anchor>
                      </Group>
                    );
                  })}
                </Group>
              ) : (
                <Group gap={4} wrap="nowrap">
                  <div
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      backgroundColor: hosts?.some((h) => h.online)
                        ? "var(--mantine-color-green-6)"
                        : "var(--mantine-color-red-6)",
                      flexShrink: 0,
                    }}
                  />
                  <Text size="sm">Any host</Text>
                </Group>
              )}
            </Table.Td>
          </Table.Tr>
          <Table.Tr>
            <Table.Td c="dimmed">Shell Model</Table.Td>
            <Table.Td>
              <Anchor
                component={Link}
                to={`/models/${encodeURIComponent(config.shellModel)}`}
                size="sm"
              >
                {config.shellModel}
              </Anchor>
            </Table.Td>
          </Table.Tr>
          {config.imageModel && (
            <Table.Tr>
              <Table.Td c="dimmed">Image Model</Table.Td>
              <Table.Td>
                <Anchor
                  component={Link}
                  to={`/models/${encodeURIComponent(config.imageModel)}`}
                  size="sm"
                >
                  {config.imageModel}
                </Anchor>
              </Table.Td>
            </Table.Tr>
          )}
          <Table.Tr>
            <Table.Td c="dimmed">Token Max</Table.Td>
            <Table.Td>{config.tokenMax.toLocaleString()}</Table.Td>
          </Table.Tr>
          {config.spendLimitDollars != null && (
            <Table.Tr>
              <Table.Td c="dimmed">Spend Limit</Table.Td>
              <Table.Td>
                ${config.spendLimitDollars}
                {config.spendLimitHours != null &&
                  ` / ${config.spendLimitHours}h`}
              </Table.Td>
            </Table.Tr>
          )}
          {config.commandProtection &&
            config.commandProtection !== "none" && (
              <Table.Tr>
                <Table.Td c="dimmed">Command Protection</Table.Td>
                <Table.Td>{config.commandProtection}</Table.Td>
              </Table.Tr>
            )}
          {config.debugPauseSeconds != null && (
            <Table.Tr>
              <Table.Td c="dimmed">Debug Pause</Table.Td>
              <Table.Td>{config.debugPauseSeconds}s</Table.Td>
            </Table.Tr>
          )}
        </Table.Tbody>
      </Table>

      {features.length > 0 && (
        <Group gap={4}>
          {features.map((f) => (
            <Badge key={f} size="sm" variant="light">
              {f}
            </Badge>
          ))}
        </Group>
      )}

      {config.initialCommands && config.initialCommands.length > 0 && (
        <div>
          <Text size="sm" c="dimmed" mb={4}>
            Initial Commands
          </Text>
          <Code block>{config.initialCommands.join("\n")}</Code>
        </div>
      )}

      <div>
        <Text size="sm" c="dimmed" mb={4}>
          Agent Prompt
        </Text>
        <Spoiler maxHeight={100} showLabel="Show more" hideLabel="Show less">
          <Code block>{config.agentPrompt}</Code>
        </Spoiler>
      </div>
    </Stack>
  );
};
