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
} from "@mantine/core";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import type { ExecutionOrder } from "shared";
import {
  ExecutionOrderForm,
  type ExecutionOrderFormData,
} from "../components/ExecutionOrderForm";
import { api } from "../lib/api";

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
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);

  const fetchItem = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const result = await api.get<ExecutionOrder>(
        `execution/orders/${id}`,
      );
      setItem(result);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchItem();
  }, [fetchItem]);

  const handleUpdate = async (data: ExecutionOrderFormData) => {
    if (!id) return;
    await api.put(`execution/orders/${id}`, {
      priority: data.priority,
      scheduledStartAt: data.scheduledStartAt || null,
      dueAt: data.dueAt || null,
      assignedTo: data.assignedTo || null,
      notes: data.notes || null,
      updatedBy: "admin",
    });
    setEditing(false);
    await fetchItem();
  };

  const handleDelete = async () => {
    if (!id || !confirm("Delete this execution order?")) return;
    await api.delete(`execution/orders/${id}`);
    navigate("/execution/orders");
  };

  const handleStart = async () => {
    if (!id) return;
    await api.post(`execution/orders/${id}/start`, {});
    await fetchItem();
  };

  const handleClose = async () => {
    if (!id) return;
    await api.post(`execution/orders/${id}/close`, {});
    await fetchItem();
  };

  const handleCancel = async () => {
    if (!id || !confirm("Cancel this execution order?")) return;
    await api.post(`execution/orders/${id}/cancel`, {});
    await fetchItem();
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
        <ExecutionOrderForm
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

  const canEdit = item.status === "released" || item.status === "started";

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
          {canEdit && (
            <Button onClick={() => setEditing(true)}>Edit</Button>
          )}
          {item.status === "released" && (
            <>
              <Button color="green" onClick={handleStart} data-testid="exec-order-start">
                Start
              </Button>
              <Button color="red" variant="outline" onClick={handleDelete}>
                Delete
              </Button>
            </>
          )}
          {item.status === "started" && (
            <Button color="green" onClick={handleClose} data-testid="exec-order-close">
              Close
            </Button>
          )}
          {canEdit && (
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
              onClick={() =>
                navigate(`/planning/orders/${item.planOrderId}`)
              }
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
          {item.startedAt && (
            <Group>
              <Text fw={600} w={140}>
                Started at:
              </Text>
              <Text>{new Date(item.startedAt).toLocaleString()}</Text>
            </Group>
          )}
          {item.closedAt && (
            <Group>
              <Text fw={600} w={140}>
                Closed at:
              </Text>
              <Text>{new Date(item.closedAt).toLocaleString()}</Text>
            </Group>
          )}
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
    </Container>
  );
};
