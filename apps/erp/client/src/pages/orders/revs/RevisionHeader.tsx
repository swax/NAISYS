import { ActionIcon, Anchor, Badge, Button, Group, Text } from "@mantine/core";
import { hasAction } from "@naisys/common";
import { ActionButton } from "@naisys/common-browser";
import type { OrderRevision } from "@naisys/erp-shared";
import { RevisionStatus } from "@naisys/erp-shared";
import { IconListDetails } from "@tabler/icons-react";
import { useNavigate } from "react-router";

import { api, apiEndpoints, showErrorNotification } from "../../../lib/api";

const STATUS_COLORS: Record<string, string> = {
  [RevisionStatus.draft]: "blue",
  [RevisionStatus.approved]: "green",
  [RevisionStatus.obsolete]: "gray",
};

interface Props {
  revision: OrderRevision;
  orderKey: string;
  revNo: string;
  onRefresh: () => void;
  onOpenOperations?: () => void;
}

export const RevisionHeader: React.FC<Props> = ({
  revision,
  orderKey,
  revNo,
  onRefresh,
  onOpenOperations,
}) => {
  const navigate = useNavigate();

  const handleApprove = async () => {
    if (!confirm(`Approve revision #${revNo}?`)) return;
    try {
      await api.post(apiEndpoints.orderRevApprove(orderKey, revNo), {});
      onRefresh();
    } catch (err) {
      showErrorNotification(err);
    }
  };

  const handleObsolete = async () => {
    if (!confirm(`Mark revision #${revNo} as obsolete?`)) return;
    try {
      await api.post(apiEndpoints.orderRevObsolete(orderKey, revNo), {});
      onRefresh();
    } catch (err) {
      showErrorNotification(err);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete revision #${revNo}?`)) return;
    try {
      await api.delete(apiEndpoints.orderRev(orderKey, revNo));
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
        {onOpenOperations && (
          <ActionIcon
            variant="subtle"
            color="gray"
            hiddenFrom="md"
            onClick={onOpenOperations}
          >
            <IconListDetails size="1.2rem" />
          </ActionIcon>
        )}
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
        <Badge color="violet" variant="light" size="sm">
          REV {revision.revNo}
        </Badge>
        <Badge
          color={STATUS_COLORS[revision.status] ?? "gray"}
          variant="light"
          size="sm"
        >
          {revision.status}
        </Badge>
        {revision.description && (
          <>
            <Text size="sm" c="dimmed">
              |
            </Text>
            <Text size="sm" c="dimmed" lineClamp={1} maw={300}>
              {revision.description}
            </Text>
          </>
        )}
      </Group>
      <Group gap="xs">
        {hasAction(revision._actions, "approve") && (
          <Button size="xs" color="green" onClick={handleApprove}>
            Approve
          </Button>
        )}
        <ActionButton
          actions={revision._actions}
          rel="cut-order"
          size="xs"
          color="teal"
          onClick={() =>
            navigate(`/orders/${orderKey}/runs/new?revNo=${revision.revNo}`)
          }
        >
          Cut Order
        </ActionButton>
        <ActionButton
          actions={revision._actions}
          rel="obsolete"
          size="xs"
          color="gray"
          variant="outline"
          onClick={handleObsolete}
        >
          Obsolete
        </ActionButton>
        {hasAction(revision._actions, "delete") && (
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
