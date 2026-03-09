import {
  Badge,
  Button,
  Card,
  Container,
  Group,
  Loader,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import type {
  AuditListResponse,
  OrderRun,
  UpdateOrderRun,
} from "@naisys-erp/shared";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";

import { OrderRunForm } from "../components/OrderRunForm";
import { api, showErrorNotification } from "../lib/api";
import { hasAction } from "../lib/hateoas";

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

export const OrderRunDetail: React.FC = () => {
  const { orderKey, id } = useParams<{ orderKey: string; id: string }>();
  const navigate = useNavigate();
  const [item, setItem] = useState<OrderRun | null>(null);
  const [auditEntries, setAuditEntries] = useState<AuditListResponse["items"]>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);

  const fetchItem = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [result, audit] = await Promise.all([
        api.get<OrderRun>(`orders/${orderKey}/runs/${id}`),
        api.get<AuditListResponse>(`audit?entityType=OrderRun&entityId=${id}`),
      ]);
      setItem(result);
      setAuditEntries(audit.items);
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setLoading(false);
    }
  }, [orderKey, id]);

  useEffect(() => {
    void fetchItem();
  }, [fetchItem]);

  const handleUpdate = async (data: UpdateOrderRun) => {
    if (!id) return;
    await api.put(`orders/${orderKey}/runs/${id}`, data);
    setEditing(false);
    await fetchItem();
  };

  const handleDelete = async () => {
    if (!id || !confirm("Delete this order run?")) return;
    try {
      await api.delete(`orders/${orderKey}/runs/${id}`);
      void navigate(`/orders/${orderKey}/runs`);
    } catch (err) {
      showErrorNotification(err);
    }
  };

  const handleStart = async () => {
    if (!id) return;
    try {
      await api.post(`orders/${orderKey}/runs/${id}/start`, {});
      await fetchItem();
    } catch (err) {
      showErrorNotification(err);
    }
  };

  const handleClose = async () => {
    if (!id) return;
    try {
      await api.post(`orders/${orderKey}/runs/${id}/close`, {});
      await fetchItem();
    } catch (err) {
      showErrorNotification(err);
    }
  };

  const handleCancel = async () => {
    if (!id || !confirm("Cancel this order run?")) return;
    try {
      await api.post(`orders/${orderKey}/runs/${id}/cancel`, {});
      await fetchItem();
    } catch (err) {
      showErrorNotification(err);
    }
  };

  if (loading) {
    return (
      <Container size="md" py="xl">
        <Stack align="center">
          <Loader />
        </Stack>
      </Container>
    );
  }

  if (!item) {
    return (
      <Container size="md" py="xl">
        <Text>Order run not found.</Text>
      </Container>
    );
  }

  if (editing) {
    return (
      <Container size="md" py="xl">
        <Title order={2} mb="lg">
          Edit Order Run
        </Title>
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
      </Container>
    );
  }

  const canEdit = !!hasAction(item._actions, "update");

  return (
    <Container size="md" py="xl">
      <Group justify="space-between" mb="lg">
        <Group>
          <Title order={2}>Order Run #{item.orderNo}</Title>
          <Badge
            color={STATUS_COLORS[item.status] ?? "gray"}
            variant="light"
            size="lg"
            data-testid="order-run-status"
          >
            {item.status}
          </Badge>
          <Badge
            color={PRIORITY_COLORS[item.priority] ?? "gray"}
            variant="light"
            size="lg"
          >
            {item.priority}
          </Badge>
        </Group>
        <Group>
          <Button
            variant="subtle"
            onClick={() => navigate(`/orders/${orderKey}/runs`)}
          >
            Back
          </Button>
          {canEdit && <Button onClick={() => setEditing(true)}>Edit</Button>}
          {hasAction(item._actions, "start") && (
            <Button
              color="green"
              onClick={handleStart}
              data-testid="order-run-start"
            >
              Start
            </Button>
          )}
          {hasAction(item._actions, "delete") && (
            <Button color="red" variant="outline" onClick={handleDelete}>
              Delete
            </Button>
          )}
          {hasAction(item._actions, "close") && (
            <Button
              color="green"
              onClick={handleClose}
              data-testid="order-run-close"
            >
              Close
            </Button>
          )}
          {hasAction(item._actions, "cancel") && (
            <Button color="orange" variant="outline" onClick={handleCancel}>
              Cancel
            </Button>
          )}
        </Group>
      </Group>

      <Card withBorder p="lg">
        <Stack gap="sm">
          <Group>
            <Text fw={600} w={140}>
              Order:
            </Text>
            <Text
              ff="monospace"
              style={{ cursor: "pointer", textDecoration: "underline" }}
              onClick={() => navigate(`/orders/${orderKey}`)}
            >
              {orderKey}
            </Text>
          </Group>
          <Group>
            <Text fw={600} w={140}>
              Order Rev ID:
            </Text>
            <Text ff="monospace">{item.orderRevId}</Text>
          </Group>
          <Group>
            <Text fw={600} w={140}>
              Assigned To:
            </Text>
            <Text>{item.assignedTo || "—"}</Text>
          </Group>
          <Group>
            <Text fw={600} w={140}>
              Scheduled Start:
            </Text>
            <Text>
              {item.scheduledStartAt
                ? new Date(item.scheduledStartAt).toLocaleString()
                : "—"}
            </Text>
          </Group>
          <Group>
            <Text fw={600} w={140}>
              Due:
            </Text>
            <Text>
              {item.dueAt ? new Date(item.dueAt).toLocaleString() : "—"}
            </Text>
          </Group>
          <Group>
            <Text fw={600} w={140}>
              Released at:
            </Text>
            <Text>{new Date(item.releasedAt).toLocaleString()}</Text>
          </Group>
          <Group>
            <Text fw={600} w={140}>
              Notes:
            </Text>
            <Text>{item.notes || "—"}</Text>
          </Group>
          <Group>
            <Text fw={600} w={140}>
              Created by:
            </Text>
            <Text>{item.createdBy}</Text>
          </Group>
          <Group>
            <Text fw={600} w={140}>
              Created at:
            </Text>
            <Text>{new Date(item.createdAt).toLocaleString()}</Text>
          </Group>
          <Group>
            <Text fw={600} w={140}>
              Updated by:
            </Text>
            <Text>{item.updatedBy}</Text>
          </Group>
          <Group>
            <Text fw={600} w={140}>
              Updated at:
            </Text>
            <Text>{new Date(item.updatedAt).toLocaleString()}</Text>
          </Group>
        </Stack>
      </Card>

      {auditEntries.length > 0 && (
        <Card withBorder p="lg" mt="lg">
          <Title order={4} mb="md">
            Status History
          </Title>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Action</Table.Th>
                <Table.Th>From</Table.Th>
                <Table.Th>To</Table.Th>
                <Table.Th>User</Table.Th>
                <Table.Th>When</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {auditEntries.map((entry) => (
                <Table.Tr key={entry.id}>
                  <Table.Td>{entry.action}</Table.Td>
                  <Table.Td>{entry.oldValue ?? "—"}</Table.Td>
                  <Table.Td>{entry.newValue ?? "—"}</Table.Td>
                  <Table.Td>{entry.userId}</Table.Td>
                  <Table.Td>
                    {new Date(entry.createdAt).toLocaleString()}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>
      )}
    </Container>
  );
};
