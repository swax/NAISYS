import {
  ActionIcon,
  Anchor,
  Badge,
  Code,
  Group,
  Stack,
  Table,
  Text,
  Tooltip,
} from "@mantine/core";
import type { AgentDetailResponse } from "@naisys/supervisor-shared";
import { IconRefresh } from "@tabler/icons-react";
import React from "react";
import { Link } from "react-router-dom";

import { TemplatedText } from "../../components/TemplatedText";
import type { Agent, Host } from "../../types/agent";

export const ConfigSummary: React.FC<{
  config: AgentDetailResponse["config"];
  resolvedEnvVars?: Record<string, string>;
  leadUsername?: string;
  assignedHosts?: { id: number; name: string }[];
  hosts?: Host[];
  agents?: Agent[];
  currentSpend?: number;
  spendLimitResetAt?: string;
  canResetSpend?: boolean;
  resettingSpend?: boolean;
  onResetSpend?: () => void;
}> = ({
  config,
  resolvedEnvVars,
  leadUsername,
  assignedHosts,
  hosts,
  agents,
  currentSpend,
  spendLimitResetAt,
  canResetSpend,
  resettingSpend,
  onResetSpend,
}) => {
  const features: string[] = [];
  if (config.mailEnabled) features.push("Mail");
  if (config.chatEnabled) features.push("Chat");
  if (config.webEnabled) features.push("Web");
  if (config.completeSessionEnabled) features.push("Complete Session");
  if (config.wakeOnMessage) features.push("Wake On Message");
  if (config.workspacesEnabled) features.push("Workspaces");
  if (config.multipleCommandsEnabled) features.push("Multiple Commands");
  if (config.controlDesktop) features.push("Control Desktop");

  return (
    <Stack gap="sm">
      <Table withRowBorders={false} style={{ maxWidth: 600 }}>
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
                      to={`/agents/${leadAgent.name}`}
                      size="sm"
                    >
                      {leadAgent.title
                        ? `${leadUsername} (${leadAgent.title})`
                        : leadUsername}
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
                          to={`/hosts/${h.name}`}
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
                <Group gap="xs" align="center">
                  <Text size="sm">
                    ${currentSpend?.toFixed(2) ?? "..."} / $
                    {config.spendLimitDollars}
                  </Text>
                  <Badge
                    size="xs"
                    variant="light"
                    color={config.spendLimitHours != null ? "blue" : "gray"}
                  >
                    {config.spendLimitHours != null
                      ? `${config.spendLimitHours}h window`
                      : "Total"}
                  </Badge>
                  {canResetSpend && (
                    <Tooltip
                      label={
                        spendLimitResetAt
                          ? `Last reset: ${new Date(spendLimitResetAt).toLocaleString()}`
                          : "Reset spend counter"
                      }
                    >
                      <ActionIcon
                        variant="subtle"
                        size="sm"
                        color="blue"
                        loading={resettingSpend}
                        onClick={onResetSpend}
                      >
                        <IconRefresh size={14} />
                      </ActionIcon>
                    </Tooltip>
                  )}
                </Group>
              </Table.Td>
            </Table.Tr>
          )}
          {config.commandProtection && config.commandProtection !== "none" && (
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

      <div>
        <Text size="sm" c="dimmed" mb={4}>
          Agent Prompt
        </Text>
        <Code block style={{ whiteSpace: "pre-wrap" }}>
          <TemplatedText template={config.agentPrompt} config={config} envVars={resolvedEnvVars} />
        </Code>
      </div>

      {config.initialCommands && config.initialCommands.length > 0 && (
        <div>
          <Text size="sm" c="dimmed" mb={4}>
            Initial Commands
          </Text>
          <Code block style={{ whiteSpace: "pre-wrap" }}>
            {config.initialCommands.map((cmd, i) => (
              <React.Fragment key={i}>
                {i > 0 && "\n\n"}
                <TemplatedText template={cmd} config={config} envVars={resolvedEnvVars} />
              </React.Fragment>
            ))}
          </Code>
        </div>
      )}
    </Stack>
  );
};
