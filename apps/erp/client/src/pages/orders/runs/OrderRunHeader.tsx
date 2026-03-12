import { ActionIcon, Anchor, Badge, Button, Group, Text } from "@mantine/core";
import { IconArrowBackUp } from "@tabler/icons-react";
import type { OrderRun, UpdateOrderRun } from "@naisys-erp/shared";
import { OrderRunPriority, OrderRunStatus } from "@naisys-erp/shared";
import { useState } from "react";
import { useNavigate } from "react-router";

import { OrderRunForm } from "../../../components/OrderRunForm";
import { api, apiEndpoints, showErrorNotification } from "../../../lib/api";
import { hasAction } from "../../../lib/hateoas";

const STATUS_COLORS: Record<string, string> = {
  [OrderRunStatus.released]: "blue",
  [OrderRunStatus.started]: "yellow",
  [OrderRunStatus.closed]: "green",
  [OrderRunStatus.cancelled]: "gray",
};

const PRIORITY_COLORS: Record<string, string> = {
  [OrderRunPriority.low]: "gray",
  [OrderRunPriority.medium]: "blue",
  [OrderRunPriority.high]: "orange",
  [OrderRunPriority.critical]: "red",
};

interface Props {
  item: OrderRun;
  orderKey: string;
  runId: string;
  onUpdate: (item: OrderRun) => void;
}

export const OrderRunHeader: React.FC<Props> = ({
  item,
  orderKey,
  runId,
  onUpdate,
}) => {
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);

  const handleUpdate = async (data: UpdateOrderRun) => {
    const updated = await api.put<OrderRun>(
      apiEndpoints.orderRun(orderKey, runId),
      data,
    );
    setEditing(false);
    onUpdate(updated);
  };

  const handleAction = async (
    action: "start" | "close" | "cancel" | "reopen",
  ) => {
    const endpointMap = {
      start: apiEndpoints.orderRunStart,
      close: apiEndpoints.orderRunClose,
      cancel: apiEndpoints.orderRunCancel,
      reopen: apiEndpoints.orderRunReopen,
    };
    try {
      const updated = await api.post<OrderRun>(
        endpointMap[action](orderKey, runId),
        {},
      );
      onUpdate(updated);
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
        <Text size="lg">
          ORDER RUN:{" "}
          <Anchor
            href={`/erp/orders/${orderKey}`}
            onClick={(e: React.MouseEvent) => {
              if (e.button === 1 || e.ctrlKey || e.metaKey) return;
              e.preventDefault();
              void navigate(`/orders/${orderKey}`);
            }}
          >
            {orderKey}
          </Anchor>
          {" / "}
          <Anchor
            href={`/erp/orders/${orderKey}/revs/${item.revNo}`}
            onClick={(e: React.MouseEvent) => {
              if (e.button === 1 || e.ctrlKey || e.metaKey) return;
              e.preventDefault();
              void navigate(`/orders/${orderKey}/revs/${item.revNo}`);
            }}
          >
            REV {item.revNo}
          </Anchor>
          {" / "}
          SN {item.runNo}
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
        {hasAction(item._actions, "update") && (
          <Button size="xs" variant="light" onClick={() => setEditing(true)}>
            Edit
          </Button>
        )}
        {hasAction(item._actions, "start") && (
          <Button size="xs" color="green" onClick={() => handleAction("start")}>
            Start
          </Button>
        )}
        {hasAction(item._actions, "close") && (
          <Button size="xs" color="green" onClick={() => handleAction("close")}>
            Close
          </Button>
        )}
        {hasAction(item._actions, "reopen") && (
          <Group gap="xs" align="center">
            <Text
              size="xs"
              c={item.status === OrderRunStatus.closed ? "green" : "orange"}
            >
              {item.status === OrderRunStatus.closed ? "Closed" : "Cancelled"}{" "}
              by {item.updatedBy} on{" "}
              {new Date(item.updatedAt).toLocaleString()}
            </Text>
            <ActionIcon
              size="xs"
              variant="subtle"
              color="gray"
              onClick={() => handleAction("reopen")}
              title={`Undo ${item.status === OrderRunStatus.closed ? "close" : "cancel"}`}
            >
              <IconArrowBackUp size={14} />
            </ActionIcon>
          </Group>
        )}
        {hasAction(item._actions, "cancel") && (
          <Button
            size="xs"
            color="orange"
            variant="outline"
            onClick={() => {
              if (confirm("Cancel this order run?")) {
                void handleAction("cancel");
              }
            }}
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
