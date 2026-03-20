import { ActionIcon, Anchor, Badge, Button, Group, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { ActionButton } from "@naisys/common-browser";
import type { OrderRun } from "@naisys-erp/shared";
import { OrderRunPriority, OrderRunStatus } from "@naisys-erp/shared";
import { IconArrowBackUp } from "@tabler/icons-react";
import { useNavigate } from "react-router";

import { api, apiEndpoints, showErrorNotification } from "../../../lib/api";
import { hasAction } from "../../../lib/hateoas";
import { CompletionDialog } from "./CompletionDialog";

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
  orderRun: OrderRun;
  orderKey: string;
  runNo: string;
  onUpdate: (orderRun: OrderRun) => void;
}

export const OrderRunHeader: React.FC<Props> = ({
  orderRun,
  orderKey,
  runNo,
  onUpdate,
}) => {
  const navigate = useNavigate();
  const [completionOpened, { open: openCompletion, close: closeCompletion }] =
    useDisclosure();

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
        endpointMap[action](orderKey, runNo),
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
      await api.delete(apiEndpoints.orderRun(orderKey, runNo));
      void navigate(`/orders/${orderKey}/runs`);
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
        <Text size="lg">
          ORDER:{" "}
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
        </Text>
        <Badge
          component="a"
          href={`/erp/orders/${orderKey}/revs/${orderRun.revNo}`}
          onClick={(e: React.MouseEvent) => {
            if (e.button === 1 || e.ctrlKey || e.metaKey) return;
            e.preventDefault();
            void navigate(`/orders/${orderKey}/revs/${orderRun.revNo}`);
          }}
          color="violet"
          variant="light"
          size="sm"
          style={{ cursor: "pointer" }}
        >
          REV {orderRun.revNo}
        </Badge>
        <Text size="lg" fw="bold">
          RUN {orderRun.runNo}
        </Text>
        <Badge
          color={STATUS_COLORS[orderRun.status] ?? "gray"}
          variant="light"
          size="sm"
          data-testid="order-run-status"
        >
          {orderRun.status}
        </Badge>
        <Badge
          color={PRIORITY_COLORS[orderRun.priority] ?? "gray"}
          variant="light"
          size="sm"
        >
          {orderRun.priority}
        </Badge>
        {orderRun.releaseNote && (
          <>
            <Text size="sm" c="dimmed">
              |
            </Text>
            <Text size="sm" c="dimmed" lineClamp={1} maw={300}>
              {orderRun.releaseNote}
            </Text>
          </>
        )}
        {orderRun.instanceKey && orderRun.itemKey && (
          <>
            <Text size="sm" c="dimmed">
              |
            </Text>
            <Text size="sm" c="dimmed">
              Completed into{" "}
              <Anchor
                size="sm"
                href={`/erp/items/${orderRun.itemKey}/instances/${orderRun.instanceId}`}
                onClick={(e: React.MouseEvent) => {
                  if (e.button === 1 || e.ctrlKey || e.metaKey) return;
                  e.preventDefault();
                  void navigate(
                    `/items/${orderRun.itemKey}/instances/${orderRun.instanceId}`,
                  );
                }}
              >
                {orderRun.itemKey} {orderRun.instanceKey}
              </Anchor>
            </Text>
          </>
        )}
      </Group>
      <Group gap="xs">
        <ActionButton
          actions={orderRun._actions}
          rel="start"
          size="xs"
          color="green"
          data-testid="order-run-start"
          onClick={() => handleAction("start")}
        >
          Start
        </ActionButton>
        <ActionButton
          actions={orderRun._actions}
          rel="complete"
          size="xs"
          color="green"
          data-testid="order-run-complete"
          onClick={openCompletion}
        >
          Complete
        </ActionButton>
        <ActionButton
          actions={orderRun._actions}
          rel="close"
          size="xs"
          color="green"
          data-testid="order-run-close"
          onClick={() => handleAction("close")}
        >
          Close
        </ActionButton>
        {hasAction(orderRun._actions, "reopen") && (
          <Group gap="xs" align="center">
            <Text
              size="xs"
              c={orderRun.status === OrderRunStatus.closed ? "green" : "orange"}
            >
              {orderRun.status === OrderRunStatus.closed
                ? "Closed"
                : "Cancelled"}{" "}
              by {orderRun.updatedBy} on{" "}
              {new Date(orderRun.updatedAt).toLocaleString()}
              {orderRun.cost ? ` for $${orderRun.cost.toFixed(2)}` : ""}
            </Text>
            <ActionIcon
              size="xs"
              variant="subtle"
              color="gray"
              onClick={() => handleAction("reopen")}
              title={`Undo ${orderRun.status === OrderRunStatus.closed ? "close" : "cancel"}`}
            >
              <IconArrowBackUp size={14} />
            </ActionIcon>
          </Group>
        )}
        {hasAction(orderRun._actions, "cancel") && (
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
        {hasAction(orderRun._actions, "delete") && (
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

      <CompletionDialog
        opened={completionOpened}
        onClose={closeCompletion}
        orderRun={orderRun}
        orderKey={orderKey}
        runNo={runNo}
        onCompleted={onUpdate}
      />
    </Group>
  );
};
