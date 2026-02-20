import { Badge, Button, Group, Stack, Table, Text, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { hasAction } from "@naisys/common";
import { IconTrash } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import React, { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAgentDataContext } from "../../contexts/AgentDataContext";
import { useConnectionStatus } from "../../hooks/useConnectionStatus";
import { useHostDataContext } from "../../contexts/HostDataContext";
import { deleteHost } from "../../lib/apiAgents";

export const HostPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { agents } = useAgentDataContext();
  const { hosts } = useHostDataContext();
  const { status: connectionStatus } = useConnectionStatus();
  const [deleting, setDeleting] = useState(false);

  const hostId = id ? Number(id) : null;
  const host = hosts.find((h) => h.id === hostId);
  const hostAgents = agents.filter((a) => a.host === host?.name);

  const handleDelete = async () => {
    if (!hostId || !host) return;
    const confirmed = window.confirm(
      `Permanently delete host "${host.name}"? This will remove all associated run sessions, logs, and cost records and cannot be undone.`,
    );
    if (!confirmed) return;

    const doubleConfirmed = window.confirm(
      `Are you absolutely sure? All historical data for host "${host.name}" will be permanently deleted.`,
    );
    if (!doubleConfirmed) return;

    setDeleting(true);
    try {
      const result = await deleteHost(hostId);
      if (result.success) {
        notifications.show({
          title: "Host Deleted",
          message: result.message,
          color: "red",
        });
        void queryClient.invalidateQueries({ queryKey: ["host-data"] });
        void navigate("/");
      } else {
        notifications.show({
          title: "Delete Failed",
          message: result.message,
          color: "red",
        });
      }
    } catch (err) {
      notifications.show({
        title: "Delete Failed",
        message: err instanceof Error ? err.message : "Unknown error",
        color: "red",
      });
    } finally {
      setDeleting(false);
    }
  };

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
      <Group justify="space-between" align="flex-start">
        <Title order={2}>
          {host?.name ?? `Host ${hostId}`}
          {connectionStatus === "connected" && (
            <>
              {" is "}
              <Text
                component="span"
                c={host?.online ? "green" : "gray"}
                inherit
              >
                {host?.online ? "online" : "offline"}
              </Text>
            </>
          )}
        </Title>
        {hasAction(host?._actions, "delete") && (
          <Button
            color="red"
            variant="outline"
            loading={deleting}
            leftSection={<IconTrash size={16} />}
            onClick={handleDelete}
          >
            Delete
          </Button>
        )}
      </Group>

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
