import { Badge, Stack, Table, Text, Title } from "@mantine/core";
import React from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAgentDataContext } from "../../contexts/AgentDataContext";
import { useConnectionStatus } from "../../hooks/useConnectionStatus";
import { useHostDataContext } from "../../contexts/HostDataContext";

export const HostPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { agents } = useAgentDataContext();
  const { hosts } = useHostDataContext();
  const { status: connectionStatus } = useConnectionStatus();

  const hostId = id ? Number(id) : null;
  const host = hosts.find((h) => h.id === hostId);
  const hostAgents = agents.filter((a) => a.host === host?.name);

  if (!hostId) {
    return (
      <Stack gap="md">
        <Text c="dimmed" ta="center">
          Select a host from the sidebar
        </Text>
      </Stack>
    );
  }

  return (
    <Stack gap="md">
      <Title order={2}>
        {host?.name ?? `Host ${hostId}`}
        {connectionStatus === "connected" && (
          <>
            {" is "}
            <Text component="span" c={host?.online ? "green" : "gray"} inherit>
              {host?.online ? "online" : "offline"}
            </Text>
          </>
        )}
      </Title>

      {hostAgents.length === 0 ? (
        <Text c="dimmed">No agents on this host</Text>
      ) : (
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Username</Table.Th>
              <Table.Th>Title</Table.Th>
              <Table.Th>Status</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {hostAgents.map((agent) => (
              <Table.Tr
                key={agent.id}
                style={{ cursor: "pointer" }}
                onClick={() => navigate(`/agents/${agent.id}`)}
              >
                <Table.Td>{agent.name}</Table.Td>
                <Table.Td>{agent.title}</Table.Td>
                <Table.Td>
                  {connectionStatus === "connected" && (
                    <Badge
                      size="sm"
                      variant="light"
                      color={agent.online ? "green" : "gray"}
                    >
                      {agent.online ? "online" : "offline"}
                    </Badge>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Stack>
  );
};
