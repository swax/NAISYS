import {
  Container,
  Title,
  Group,
  Button,
  Text,
  Loader,
  Stack,
  Badge,
  Card,
  Table,
} from "@mantine/core";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import type {
  AuditListResponse,
  ExecutionOrder,
  UpdateExecutionOrder,
} from "@naisys-erp/shared";
import { ExecutionOrderForm } from "../components/ExecutionOrderForm";
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

export const ExecutionOrderDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [item, setItem] = useState<ExecutionOrder | null>(null);
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
        api.get<ExecutionOrder>(`execution/orders/${id}`),
        api.get<AuditListResponse>(`audit?entityType=ExecOrder&entityId=${id}`),
      ]);
      setItem(result);
      setAuditEntries(audit.items);
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void fetchItem();
  }, [fetchItem]);

  const handleUpdate = async (data: UpdateExecutionOrder) => {
    if (!id) return;
    await api.put(`execution/orders/${id}`, data);
    setEditing(false);
    await fetchItem();
  };

  const handleDelete = async () => {
    if (!id || !confirm("Delete this execution order?")) return;
    try {
      await api.delete(`execution/orders/${id}`);
      void navigate("/execution/orders");
    } catch (err) {
      showErrorNotification(err);
    }
  };

  const handleStart = async () => {
    if (!id) return;
    try {
      await api.post(`execution/orders/${id}/start`, {});
      await fetchItem();
    } catch (err) {
      showErrorNotification(err);
    }
  };

  const handleClose = async () => {
    if (!id) return;
    try {
      await api.post(`execution/orders/${id}/close`, {});
      await fetchItem();
    } catch (err) {
      showErrorNotification(err);
    }
  };

  const handleCancel = async () => {
    if (!id || !confirm("Cancel this execution order?")) return;
    try {
      await api.post(`execution/orders/${id}/cancel`, {});
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
        <Text>Execution order not found.</Text>
      </Container>
    );
  }

  if (editing) {
    return (
      <Container size="md" py="xl">
        <Title order={2} mb="lg">
          Edit Execution Order
        </Title>
        <ExecutionOrderForm<true>
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
          <Title order={2}>Execution Order #{item.orderNo}</Title>
          <Badge
            color={STATUS_COLORS[item.status] ?? "gray"}
            variant="light"
            size="lg"
            data-testid="exec-order-status"
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
            onClick={() => navigate("/execution/orders")}
          >
            Back
          </Button>
          {canEdit && <Button onClick={() => setEditing(true)}>Edit</Button>}
          {hasAction(item._actions, "start") && (
            <Button
              color="green"
              onClick={handleStart}
              data-testid="exec-order-start"
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
              data-testid="exec-order-close"
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
              Plan Order ID:
            </Text>
            <Text
              ff="monospace"
              style={{ cursor: "pointer", textDecoration: "underline" }}
              onClick={() => navigate(`/planning/orders/${item.planOrderId}`)}
            >
              {item.planOrderId}
            </Text>
          </Group>
          <Group>
            <Text fw={600} w={140}>
              Plan Rev ID:
            </Text>
            <Text ff="monospace">{item.planOrderRevId}</Text>
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
