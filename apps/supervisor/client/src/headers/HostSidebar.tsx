import {
  Badge,
  Button,
  Card,
  Group,
  Modal,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { hasAction } from "@naisys/common";
import { IconPlus, IconServer } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import React, { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { ROUTER_BASENAME } from "../constants";
import { useHostDataContext } from "../contexts/HostDataContext";
import { useConnectionStatus } from "../hooks/useConnectionStatus";
import { createHostApi } from "../lib/apiAgents";
import { Host } from "../types/agent";

export const HostSidebar: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { hosts, listActions, isLoading } = useHostDataContext();
  const { status: connectionStatus } = useConnectionStatus();

  const [createOpen, setCreateOpen] = useState(false);
  const [newHostName, setNewHostName] = useState("");
  const [creating, setCreating] = useState(false);

  const isHostSelected = (hostId: number) => {
    const pathParts = location.pathname.split("/");
    // Path: /hosts/:id
    return pathParts[2] === String(hostId);
  };

  const getHostUrl = (host: Host) => `/hosts/${host.id}`;

  const getHostAbsoluteUrl = (host: Host) =>
    `${ROUTER_BASENAME}${getHostUrl(host)}`;

  const handleHostClick = (e: React.MouseEvent, host: Host) => {
    if (e.button === 1 || e.ctrlKey || e.metaKey) {
      return;
    }
    e.preventDefault();
    void navigate(getHostUrl(host));
  };

  const handleCreate = async () => {
    if (!newHostName.trim()) return;
    setCreating(true);
    try {
      const result = await createHostApi(newHostName.trim());
      if (result.success) {
        notifications.show({
          title: "Host Created",
          message: result.message,
          color: "green",
        });
        setCreateOpen(false);
        setNewHostName("");
        void queryClient.invalidateQueries({ queryKey: ["host-data"] });
        // Navigate to the new host if id is in the result
        const newId = (result as { id?: number }).id;
        if (newId) {
          void navigate(`/hosts/${newId}`);
        }
      } else {
        notifications.show({
          title: "Create Failed",
          message: result.message,
          color: "red",
        });
      }
    } catch (err) {
      notifications.show({
        title: "Create Failed",
        message: err instanceof Error ? err.message : "Unknown error",
        color: "red",
      });
    } finally {
      setCreating(false);
    }
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
              backgroundColor: isHostSelected(host.id)
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
              <Group gap={4} style={{ flexShrink: 0 }} wrap="nowrap">
                {host.restricted && (
                  <Badge size="xs" variant="light" color="orange">
                    R
                  </Badge>
                )}
                {connectionStatus === "connected" && (
                  <Badge
                    size="xs"
                    variant="light"
                    color={host.online ? "green" : "gray"}
                  >
                    {host.online ? "online" : "offline"}
                  </Badge>
                )}
              </Group>
            </Group>
          </Card>
        ))}

        {hasAction(listActions, "create") && (
          <Button
            variant="subtle"
            size="compact-sm"
            leftSection={<IconPlus size={14} />}
            onClick={() => setCreateOpen(true)}
          >
            Add Host
          </Button>
        )}
      </Stack>

      <Modal
        opened={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create Host"
        size="sm"
      >
        <Stack gap="md">
          <TextInput
            label="Host Name"
            placeholder="my-host"
            value={newHostName}
            onChange={(e) => setNewHostName(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleCreate();
            }}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={creating}
              disabled={!newHostName.trim()}
              onClick={handleCreate}
            >
              Create
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
};
