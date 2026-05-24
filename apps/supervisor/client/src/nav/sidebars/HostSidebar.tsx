import {
  Alert,
  Badge,
  Button,
  Card,
  Code,
  CopyButton,
  Group,
  Modal,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { hasAction } from "@naisys/common";
import {
  IconCheck,
  IconCopy,
  IconInfoCircle,
  IconPlus,
  IconServer,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import React, { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { PlatformBadge } from "../../components/badges/PlatformBadge";
import { ROUTER_BASENAME } from "../../constants";
import { useHostDataContext } from "../../contexts/HostDataContext";
import { useConnectionStatus } from "../../hooks/useConnectionStatus";
import { createHostApi } from "../../lib/api/apiAgents";
import type { Host } from "../../types/agent";

export const HostSidebar: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { hosts, listActions, isLoading } = useHostDataContext();
  const { serverReachable } = useConnectionStatus();

  const [createOpen, setCreateOpen] = useState(false);
  const [newHostName, setNewHostName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createdHost, setCreatedHost] = useState<{
    name: string;
    accessKey: string;
  } | null>(null);

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
    const name = newHostName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const result = await createHostApi(name);
      if (result.success && result.accessKey) {
        notifications.show({
          title: "Host Created",
          message: result.message,
          color: "green",
        });
        setCreateOpen(false);
        setNewHostName("");
        setCreatedHost({ name, accessKey: result.accessKey });
        void queryClient.invalidateQueries({ queryKey: ["host-data"] });
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

  const dismissCreatedHost = () => {
    const name = createdHost?.name;
    setCreatedHost(null);
    if (name) void navigate(`/hosts/${name}`);
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
              {serverReachable && (
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
          setNewHostName("");
        }}
        title="Add Host"
        size="sm"
      >
        <Stack gap="md">
          <Text size="sm">
            Create the host here, then copy the generated access key into the
            NAISYS instance's <Code>HOST_ACCESS_KEY</Code> env var.
          </Text>
          <TextInput
            label="Host Name"
            placeholder="my-host"
            value={newHostName}
            onChange={(e) => setNewHostName(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleCreate();
            }}
            autoFocus
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

      <Modal
        opened={createdHost !== null}
        onClose={dismissCreatedHost}
        title={`Access Key for "${createdHost?.name ?? ""}"`}
        centered
        size="lg"
      >
        <Stack gap="sm">
          <Alert color="yellow" icon={<IconInfoCircle size={16} />}>
            Copy this now — it will not be shown again. Set it on the NAISYS
            host as <Code>HOST_ACCESS_KEY</Code> in its <Code>.env</Code>.
          </Alert>
          <Code block style={{ wordBreak: "break-all" }}>
            {createdHost?.accessKey ?? ""}
          </Code>
          <Group justify="flex-end">
            <CopyButton value={createdHost?.accessKey ?? ""}>
              {({ copied, copy }) => (
                <Button
                  variant="default"
                  leftSection={
                    copied ? <IconCheck size={16} /> : <IconCopy size={16} />
                  }
                  onClick={copy}
                >
                  {copied ? "Copied" : "Copy key"}
                </Button>
              )}
            </CopyButton>
            <Button color="blue" onClick={dismissCreatedHost}>
              Done
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
};
