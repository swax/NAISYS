import {
  Anchor,
  Badge,
  Button,
  Card,
  Code,
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

import { PlatformBadge } from "../components/PlatformBadge";
import { ROUTER_BASENAME } from "../constants";
import { useHostDataContext } from "../contexts/HostDataContext";
import { useConnectionStatus } from "../hooks/useConnectionStatus";
import { createHostApi } from "../lib/apiAgents";
import type { Host } from "../types/agent";

export const HostSidebar: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { hosts, listActions, isLoading } = useHostDataContext();
  const { status: connectionStatus } = useConnectionStatus();

  const [createOpen, setCreateOpen] = useState(false);
  const [showManualCreate, setShowManualCreate] = useState(false);
  const [newHostName, setNewHostName] = useState("");
  const [creating, setCreating] = useState(false);

  const isHostSelected = (hostname: string) => {
    const pathParts = location.pathname.split("/");
    // Path: /hosts/:hostname
    return pathParts[2] === hostname;
  };

  const getHostUrl = (host: Host) => `/hosts/${host.name}`;

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
        void navigate(`/hosts/${newHostName.trim()}`);
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
                <Group gap={4} mt={6} wrap="nowrap">
                  {host.hostType === "supervisor" ? (
                    <Badge size="xs" variant="light" color="violet">
                      Supervisor
                    </Badge>
                  ) : (
                    <PlatformBadge platform={host.platform} />
                  )}
                  {host.agentCount > 0 && (
                    <Badge size="xs" variant="light" color="gray">
                      {host.agentCount} assigned
                    </Badge>
                  )}
                  {host.restricted && (
                    <Badge size="xs" variant="light" color="orange">
                      Restricted
                    </Badge>
                  )}
                </Group>
              </div>
              {connectionStatus === "connected" && (
                <Badge
                  size="xs"
                  variant="light"
                  color={host.online ? "green" : "gray"}
                  style={{ flexShrink: 0 }}
                >
                  {host.online ? "online" : "offline"}
                </Badge>
              )}
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
        onClose={() => {
          setCreateOpen(false);
          setShowManualCreate(false);
          setNewHostName("");
        }}
        title="Add Host"
        size="sm"
      >
        <Stack gap="md">
          <Text size="sm">
            Use the hub key found on the{" "}
            <Anchor href="/admin" fw={500}>
              Admin
            </Anchor>{" "}
            page to configure a NAISYS instance with the environment variables{" "}
            <Code>NAISYS_HOSTNAME</Code> and <Code>HUB_ACCESS_KEY</Code>. On
            connect, the host will be created automatically if it doesn't
            already exist.
          </Text>

          {!showManualCreate ? (
            <Anchor
              size="sm"
              component="button"
              onClick={() => setShowManualCreate(true)}
            >
              Manually create host
            </Anchor>
          ) : (
            <Stack gap="sm">
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
          )}
        </Stack>
      </Modal>
    </>
  );
};
