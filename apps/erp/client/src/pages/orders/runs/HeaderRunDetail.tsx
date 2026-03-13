import {
  Badge,
  Button,
  Card,
  Container,
  Group,
  Stack,
  Text,
} from "@mantine/core";
import type {
  OrderRevision,
  OrderRun,
  UpdateOrderRun,
} from "@naisys-erp/shared";
import { OrderRunPriority } from "@naisys-erp/shared";
import { useCallback, useEffect, useState } from "react";
import { Link, useOutletContext, useParams } from "react-router";

import { CompactMarkdown } from "../../../components/CompactMarkdown";
import { MetadataTooltip } from "../../../components/MetadataTooltip";
import { OrderRunForm } from "../../../components/OrderRunForm";
import { api, apiEndpoints, showErrorNotification } from "../../../lib/api";
import { hasAction } from "../../../lib/hateoas";
import type { OrderRunOutletContext } from "./OrderRunDetail";

const PRIORITY_COLORS: Record<string, string> = {
  [OrderRunPriority.low]: "gray",
  [OrderRunPriority.medium]: "blue",
  [OrderRunPriority.high]: "orange",
  [OrderRunPriority.critical]: "red",
};

function formatDateTime(iso: string | null): string {
  if (!iso) return "\u2014";
  return new Date(iso).toLocaleString();
}

export const HeaderRunDetail: React.FC = () => {
  const { orderKey, id: runId } = useParams<{
    orderKey: string;
    id: string;
  }>();
  const { orderRun: item, onOrderRunUpdate } =
    useOutletContext<OrderRunOutletContext>();
  const [editing, setEditing] = useState(false);
  const [revDescription, setRevDescription] = useState<string | null>(null);

  const fetchRevision = useCallback(async () => {
    if (!orderKey) return;
    try {
      const rev = await api.get<OrderRevision>(
        apiEndpoints.orderRev(orderKey, item.revNo),
      );
      setRevDescription(rev.description || null);
    } catch {
      // ignore – revision description is supplementary
    }
  }, [orderKey, item.revNo]);

  useEffect(() => {
    void fetchRevision();
  }, [fetchRevision]);

  const handleUpdate = async (data: UpdateOrderRun) => {
    try {
      const updated = await api.put<OrderRun>(
        apiEndpoints.orderRun(orderKey!, runId!),
        data,
      );
      onOrderRunUpdate(updated);
      setEditing(false);
    } catch (err) {
      showErrorNotification(err);
    }
  };

  const canEdit = hasAction(item._actions, "update");

  return (
    <Container size="md" py="xl" w="100%">
      <Stack gap="md">
        <Group justify="space-between">
          <Group gap="xs">
            <Text fw={600}>HEADER</Text>
            <MetadataTooltip
              createdBy={item.createdBy}
              createdAt={item.createdAt}
              updatedBy={item.updatedBy}
              updatedAt={item.updatedAt}
            />
          </Group>
          {canEdit && !editing && (
            <Button size="xs" variant="light" onClick={() => setEditing(true)}>
              Edit
            </Button>
          )}
        </Group>

        <Card withBorder p="lg">
          {editing ? (
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
          ) : (
            <Stack gap="sm">
              <Group>
                <Text fw={600} w={140}>
                  Produces Item:
                </Text>
                {item.itemKey ? (
                  <Text
                    component={Link}
                    to={`/items/${item.itemKey}`}
                    size="sm"
                    c="blue"
                    style={{ textDecoration: "none" }}
                  >
                    {item.itemKey}
                  </Text>
                ) : (
                  <Text c="dimmed">{"\u2014"}</Text>
                )}
              </Group>
              <Group align="flex-start">
                <Text fw={600} w={140}>
                  Description:
                </Text>
                {revDescription ? (
                  <CompactMarkdown>{revDescription}</CompactMarkdown>
                ) : (
                  <Text c="dimmed">{"\u2014"}</Text>
                )}
              </Group>
              <Group>
                <Text fw={600} w={140}>
                  Priority:
                </Text>
                <Badge
                  color={PRIORITY_COLORS[item.priority] ?? "gray"}
                  variant="light"
                >
                  {item.priority}
                </Badge>
              </Group>
              <Group>
                <Text fw={600} w={140}>
                  Scheduled Start:
                </Text>
                <Text>{formatDateTime(item.scheduledStartAt)}</Text>
              </Group>
              <Group>
                <Text fw={600} w={140}>
                  Due Date:
                </Text>
                <Text>{formatDateTime(item.dueAt)}</Text>
              </Group>
              <Group>
                <Text fw={600} w={140}>
                  Assigned To:
                </Text>
                <Text>{item.assignedTo ?? "\u2014"}</Text>
              </Group>
              <Group align="flex-start">
                <Text fw={600} w={140}>
                  Notes:
                </Text>
                <Text style={{ whiteSpace: "pre-wrap" }}>
                  {item.notes ?? "\u2014"}
                </Text>
              </Group>
            </Stack>
          )}
        </Card>
      </Stack>
    </Container>
  );
};
