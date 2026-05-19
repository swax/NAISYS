import {
  ActionIcon,
  Badge,
  CloseButton,
  Group,
  Menu,
  Text,
} from "@mantine/core";
import { IconPlus, IconServer } from "@tabler/icons-react";
import { useMemo } from "react";
import { Link } from "react-router-dom";

interface HostOption {
  id: number;
  name: string;
}

interface AgentAssignedHostsPanelProps {
  assignedHosts: HostOption[];
  availableHosts: HostOption[];
  hostActionInProgress?: boolean;
  onAssignHost?: (hostname: string) => void;
  onUnassignHost?: (hostname: string) => void;
}

export const AgentAssignedHostsPanel: React.FC<
  AgentAssignedHostsPanelProps
> = ({
  assignedHosts,
  availableHosts,
  hostActionInProgress,
  onAssignHost,
  onUnassignHost,
}) => {
  const unassignedHosts = useMemo(() => {
    const assignedIds = new Set(assignedHosts.map((h) => h.id));
    return availableHosts.filter((h) => !assignedIds.has(h.id));
  }, [availableHosts, assignedHosts]);

  return (
    <Group gap="xs" wrap="wrap" align="center">
      {assignedHosts.length === 0 ? (
        <Text size="sm" c="dimmed">
          None assigned, agent can run on any host
        </Text>
      ) : (
        assignedHosts.map((h) => (
          <Badge
            key={h.id}
            component={Link}
            to={`/hosts/${h.name}`}
            variant="light"
            color="blue"
            size="lg"
            leftSection={<IconServer size={14} />}
            style={{ cursor: "pointer", textTransform: "none" }}
            rightSection={
              onUnassignHost ? (
                <CloseButton
                  size="xs"
                  variant="transparent"
                  disabled={hostActionInProgress}
                  aria-label="Unassign host"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onUnassignHost(h.name);
                  }}
                />
              ) : undefined
            }
          >
            {h.name}
          </Badge>
        ))
      )}
      {onAssignHost && (
        <Menu shadow="md" width={260} position="bottom-start">
          <Menu.Target>
            <ActionIcon
              size="sm"
              variant="subtle"
              color="blue"
              loading={hostActionInProgress}
              disabled={unassignedHosts.length === 0}
              title="Assign host"
            >
              <IconPlus size={14} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            {unassignedHosts.map((h) => (
              <Menu.Item key={h.id} onClick={() => onAssignHost(h.name)}>
                {h.name}
              </Menu.Item>
            ))}
          </Menu.Dropdown>
        </Menu>
      )}
    </Group>
  );
};
