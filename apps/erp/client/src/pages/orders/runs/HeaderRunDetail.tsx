import {
  Badge,
  Button,
  Card,
  Container,
  Group,
  Stack,
  Text,
} from "@mantine/core";
import { hasAction } from "@naisys/common";
import { CompactMarkdown } from "@naisys/common-browser";
import type {
  OperationRunListResponse,
  OrderRun,
  UpdateOrderRun,
} from "@naisys/erp-shared";
import { OrderRunPriority } from "@naisys/erp-shared";
import { useCallback, useEffect, useState } from "react";
import { Link, useOutletContext, useParams } from "react-router";

import { MetadataTooltip } from "../../../components/MetadataTooltip";
import { OperationSummaryTable } from "../../../components/OperationSummaryTable";
import { OrderRunForm } from "../../../components/OrderRunForm";
import { api, apiEndpoints, showErrorNotification } from "../../../lib/api";
import type { OrderRunOutletContext } from "./OrderRunDetail";

const PRIORITY_COLORS: Record<string, string> = {
  [OrderRunPriority.low]: "gray",
  [OrderRunPriority.medium]: "blue",
  [OrderRunPriority.high]: "orange",
  [OrderRunPriority.critical]: "red",
};

export const HeaderRunDetail: React.FC = () => {
  const { orderKey, runNo } = useParams<{
    orderKey: string;
    runNo: string;
  }>();
  const { orderRun, onOrderRunUpdate } =
    useOutletContext<OrderRunOutletContext>();
  const [editing, setEditing] = useState(false);
  const [operations, setOperations] = useState<OperationRunListResponse | null>(
    null,
  );
  const [opsLoading, setOpsLoading] = useState(true);

  const fetchOperations = useCallback(async () => {
    if (!orderKey || !runNo) return;
    setOpsLoading(true);
    try {
      const result = await api.get<OperationRunListResponse>(
        apiEndpoints.operationRuns(orderKey, runNo),
      );
      setOperations(result);
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setOpsLoading(false);
    }
  }, [orderKey, runNo]);

  useEffect(() => {
    void fetchOperations();
  }, [fetchOperations]);

  const handleUpdate = async (data: UpdateOrderRun) => {
    try {
      const updated = await api.put<OrderRun>(
        apiEndpoints.orderRun(orderKey!, runNo!),
        data,
      );
      onOrderRunUpdate(updated);
      setEditing(false);
    } catch (err) {
      showErrorNotification(err);
    }
  };

  const canEdit = hasAction(orderRun._actions, "update");

  return (
    <Container size="md" py="xl" w="100%">
      <Stack gap="md">
        <Group justify="space-between">
          <Group gap="xs">
            <Text fw={600}>HEADER</Text>
            <MetadataTooltip
              createdBy={orderRun.createdBy}
              createdAt={orderRun.createdAt}
              updatedBy={orderRun.updatedBy}
              updatedAt={orderRun.updatedAt}
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
                priority: orderRun.priority,
                dueAt: orderRun.dueAt ?? "",
                releaseNote: orderRun.releaseNote ?? "",
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
                {orderRun.itemKey ? (
                  <Text
                    component={Link}
                    to={`/items/${orderRun.itemKey}`}
                    size="sm"
                    c="blue"
                    style={{ textDecoration: "none" }}
                  >
                    {orderRun.itemKey}
                  </Text>
                ) : (
                  <Text c="dimmed">{"\u2014"}</Text>
                )}
              </Group>
              <Group align="flex-start">
                <Text fw={600} w={140}>
                  Description:
                </Text>
                {orderRun.description ? (
                  <CompactMarkdown>{orderRun.description}</CompactMarkdown>
                ) : (
                  <Text c="dimmed">{"\u2014"}</Text>
                )}
              </Group>
              <Group>
                <Text fw={600} w={140}>
                  Priority:
                </Text>
                <Badge
                  color={PRIORITY_COLORS[orderRun.priority] ?? "gray"}
                  variant="light"
                >
                  {orderRun.priority}
                </Badge>
              </Group>
              <Group>
                <Text fw={600} w={140}>
                  Due Date:
                </Text>
                <Text>{orderRun.dueAt ?? "\u2014"}</Text>
              </Group>
              <Group align="flex-start">
                <Text fw={600} w={140}>
                  Release Note:
                </Text>
                <Text style={{ whiteSpace: "pre-wrap" }}>
                  {orderRun.releaseNote ?? "\u2014"}
                </Text>
              </Group>
            </Stack>
          )}
        </Card>

        <OperationSummaryTable
          items={operations?.items ?? null}
          loading={opsLoading}
          linkBuilder={(seqNo) =>
            `/orders/${orderKey}/runs/${runNo}/ops/${seqNo}`
          }
        />
      </Stack>
    </Container>
  );
};
