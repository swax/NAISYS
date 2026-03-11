import { Badge, Button, Group, Text } from "@mantine/core";
import type { OrderRun, UpdateOrderRun } from "@naisys-erp/shared";
import { useState } from "react";
import { useNavigate } from "react-router";

import { OrderRunForm } from "../../../components/OrderRunForm";
import { api, apiEndpoints, showErrorNotification } from "../../../lib/api";
import { hasAction } from "../../../lib/hateoas";

const STATUS_COLORS: Record<string, string> = {
  released: "blue",
  started: "yellow",
  closed: "green",
  cancelled: "gray",
};

const PRIORITY_COLORS: Record<string, string> = {
  low: "gray",
  medium: "blue",
  high: "orange",
  critical: "red",
};

interface Props {
  item: OrderRun;
  orderKey: string;
  runId: string;
  onRefresh: () => void;
}

export const OrderRunHeader: React.FC<Props> = ({
  item,
  orderKey,
  runId,
  onRefresh,
}) => {
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);

  const handleUpdate = async (data: UpdateOrderRun) => {
    await api.put(apiEndpoints.orderRun(orderKey, runId), data);
    setEditing(false);
    onRefresh();
  };

  const handleStart = async () => {
    try {
      await api.post(apiEndpoints.orderRunStart(orderKey, runId), {});
      onRefresh();
    } catch (err) {
      showErrorNotification(err);
    }
  };

  const handleClose = async () => {
    try {
      await api.post(apiEndpoints.orderRunClose(orderKey, runId), {});
      onRefresh();
    } catch (err) {
      showErrorNotification(err);
    }
  };

  const handleCancel = async () => {
    if (!confirm("Cancel this order run?")) return;
    try {
      await api.post(apiEndpoints.orderRunCancel(orderKey, runId), {});
      onRefresh();
    } catch (err) {
      showErrorNotification(err);
    }
  };

  const handleDelete = async () => {
    if (!confirm("Delete this order run?")) return;
    try {
      await api.delete(apiEndpoints.orderRun(orderKey, runId));
      void navigate(`/orders/${orderKey}/runs`);
    } catch (err) {
      showErrorNotification(err);
    }
  };

  if (editing) {
    return (
      <div
        style={{
          borderBottom:
            "calc(0.125rem * var(--mantine-scale)) solid var(--mantine-color-dark-4)",
          padding: "var(--mantine-spacing-md)",
        }}
      >
        <OrderRunForm<true>
          initialData={{
            priority: item.priority,
            scheduledStartAt: item.scheduledStartAt
              ? item.scheduledStartAt.slice(0, 16)
              : "",
            dueAt: item.dueAt ? item.dueAt.slice(0, 16) : "",
            assignedTo: item.assignedTo ?? "",
            notes: item.notes ?? "",
          }}
          isEdit
          onSubmit={handleUpdate}
          onCancel={() => setEditing(false)}
        />
      </div>
    );
  }

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
          Run #{item.runNo}
        </Text>
        <Badge
          color={STATUS_COLORS[item.status] ?? "gray"}
          variant="light"
          size="sm"
        >
          {item.status}
        </Badge>
        <Badge
          color={PRIORITY_COLORS[item.priority] ?? "gray"}
          variant="light"
          size="sm"
        >
          {item.priority}
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
          onClick={() => navigate(`/orders/${orderKey}/runs`)}
        >
          Back
        </Button>
        {hasAction(item._actions, "update") && (
          <Button size="xs" variant="light" onClick={() => setEditing(true)}>
            Edit
          </Button>
        )}
        {hasAction(item._actions, "start") && (
          <Button size="xs" color="green" onClick={handleStart}>
            Start
          </Button>
        )}
        {hasAction(item._actions, "close") && (
          <Button size="xs" color="green" onClick={handleClose}>
            Close
          </Button>
        )}
        {hasAction(item._actions, "cancel") && (
          <Button
            size="xs"
            color="orange"
            variant="outline"
            onClick={handleCancel}
          >
            Cancel
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
