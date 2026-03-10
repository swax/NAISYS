import { Badge, Button, Group, Text } from "@mantine/core";
import type { OrderRevision } from "@naisys-erp/shared";
import { useNavigate } from "react-router";

import { api, showErrorNotification } from "../../../lib/api";
import { hasAction } from "../../../lib/hateoas";

const STATUS_COLORS: Record<string, string> = {
  draft: "blue",
  approved: "green",
  obsolete: "gray",
};

interface Props {
  item: OrderRevision;
  orderKey: string;
  revNo: string;
  onRefresh: () => void;
}

export const RevisionHeader: React.FC<Props> = ({
  item,
  orderKey,
  revNo,
  onRefresh,
}) => {
  const navigate = useNavigate();

  const handleApprove = async () => {
    if (!confirm(`Approve revision #${revNo}?`)) return;
    try {
      await api.post(`orders/${orderKey}/revs/${revNo}/approve`, {});
      onRefresh();
    } catch (err) {
      showErrorNotification(err);
    }
  };

  const handleObsolete = async () => {
    if (!confirm(`Mark revision #${revNo} as obsolete?`)) return;
    try {
      await api.post(`orders/${orderKey}/revs/${revNo}/obsolete`, {});
      onRefresh();
    } catch (err) {
      showErrorNotification(err);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete revision #${revNo}?`)) return;
    try {
      await api.delete(`orders/${orderKey}/revs/${revNo}`);
      void navigate(`/orders/${orderKey}`);
    } catch (err) {
      showErrorNotification(err);
    }
  };

  return (
    <Group
      justify="space-between"
      px="md"
      py="xs"
      style={{
        borderBottom:
          "calc(0.125rem * var(--mantine-scale)) solid var(--mantine-color-dark-4)",
      }}
    >
      <Group gap="sm">
        <Text
          size="sm"
          c="dimmed"
          style={{ cursor: "pointer" }}
          onClick={() => navigate(`/orders/${orderKey}`)}
        >
          {orderKey}
        </Text>
        <Text size="sm" c="dimmed">
          /
        </Text>
        <Text size="sm" fw={600}>
          Rev #{item.revNo}
        </Text>
        <Badge
          color={STATUS_COLORS[item.status] ?? "gray"}
          variant="light"
          size="sm"
        >
          {item.status}
        </Badge>
        {item.notes && (
          <>
            <Text size="sm" c="dimmed">
              |
            </Text>
            <Text size="sm" c="dimmed" lineClamp={1} maw={300}>
              {item.notes}
            </Text>
          </>
        )}
      </Group>
      <Group gap="xs">
        <Button
          size="xs"
          variant="subtle"
          onClick={() => navigate(`/orders/${orderKey}`)}
        >
          Back
        </Button>
        {hasAction(item._actions, "approve") && (
          <Button size="xs" color="green" onClick={handleApprove}>
            Approve
          </Button>
        )}
        {hasAction(item._actions, "cut-order") && (
          <Button
            size="xs"
            color="teal"
            onClick={() =>
              navigate(`/orders/${orderKey}/runs/new?revNo=${item.revNo}`)
            }
          >
            Cut Order
          </Button>
        )}
        {hasAction(item._actions, "obsolete") && (
          <Button
            size="xs"
            color="gray"
            variant="outline"
            onClick={handleObsolete}
          >
            Obsolete
          </Button>
        )}
        {hasAction(item._actions, "delete") && (
          <Button
            size="xs"
            color="red"
            variant="outline"
            onClick={handleDelete}
          >
            Delete
          </Button>
        )}
      </Group>
    </Group>
  );
};
