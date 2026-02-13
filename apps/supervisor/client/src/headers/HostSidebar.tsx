import { Badge, Card, Group, Stack, Text } from "@mantine/core";
import { IconServer } from "@tabler/icons-react";
import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ROUTER_BASENAME } from "../constants";
import { useAgentDataContext } from "../contexts/AgentDataContext";
import { Host } from "../types/agent";

export const HostSidebar: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { hosts, isLoading } = useAgentDataContext();

  const isHostSelected = (hostName: string) => {
    const pathParts = location.pathname.split("/");
    // Path: /hosts/:hostName
    return pathParts[2] === hostName;
  };

  const getHostUrl = (host: Host) => `/hosts/${host.name}`;

  const getHostAbsoluteUrl = (host: Host) =>
    `${ROUTER_BASENAME}${getHostUrl(host)}`;

  const handleHostClick = (e: React.MouseEvent, host: Host) => {
    if (e.button === 1 || e.ctrlKey || e.metaKey) {
      return;
    }
    e.preventDefault();
    navigate(getHostUrl(host));
  };

  if (isLoading) {
    return (
      <Text size="sm" c="dimmed">
        Loading hosts...
      </Text>
    );
  }

  return (
    <>
      <Stack gap="xs">
        {hosts.map((host) => (
          <Card
            key={host.name}
            padding="sm"
            radius="md"
            withBorder
            component="a"
            href={getHostAbsoluteUrl(host)}
            onClick={(e) => handleHostClick(e, host)}
            style={{
              cursor: "pointer",
              backgroundColor: isHostSelected(host.name)
                ? "var(--mantine-color-blue-9)"
                : undefined,
              textDecoration: "none",
              color: "inherit",
              display: "block",
            }}
          >
            <Group justify="space-between" align="center" wrap="nowrap">
              <div style={{ minWidth: 0, flex: 1 }}>
                <Group gap="xs" align="center" wrap="nowrap">
                  <IconServer size="1rem" style={{ flexShrink: 0 }} />
                  <Text size="sm" fw={500} truncate="end">
                    {host.name}
                  </Text>
                </Group>
                <Text size="xs" c="dimmed">
                  {host.agentCount} agent{host.agentCount !== 1 ? "s" : ""}
                </Text>
              </div>
              <Badge
                size="xs"
                variant="light"
                color={host.online ? "green" : "gray"}
                style={{ flexShrink: 0 }}
              >
                {host.online ? "online" : "offline"}
              </Badge>
            </Group>
          </Card>
        ))}
      </Stack>
    </>
  );
};
