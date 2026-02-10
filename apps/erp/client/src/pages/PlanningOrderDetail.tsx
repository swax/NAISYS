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
import type { PlanningOrder } from "shared";
import {
  PlanningOrderForm,
  type PlanningOrderFormData,
} from "../components/PlanningOrderForm";
import { PlanningOrderRevisions } from "../components/PlanningOrderRevisions";
import { api, showErrorNotification } from "../lib/api";

export const PlanningOrderDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [item, setItem] = useState<PlanningOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);

  const fetchItem = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const result = await api.get<PlanningOrder>(
        `planning/orders/${id}`,
      );
      setItem(result);
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchItem();
  }, [fetchItem]);

  const handleUpdate = async (data: PlanningOrderFormData) => {
    if (!id) return;
    await api.put(`planning/orders/${id}`, {
      ...data,
      updatedBy: "admin",
    });
    setEditing(false);
    await fetchItem();
  };

  const handleDelete = async () => {
    if (!id || !confirm("Delete this planning order?")) return;
    try {
      await api.delete(`planning/orders/${id}`);
      navigate("/planning/orders");
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
        <Text>Planning order not found.</Text>
      </Container>
    );
  }

  if (editing) {
    return (
      <Container size="md" py="xl">
        <Title order={2} mb="lg">
          Edit Planning Order
        </Title>
        <PlanningOrderForm
          initialData={{
            key: item.key,
            name: item.name,
            description: item.description,
            status: item.status,
          }}
          isEdit
          onSubmit={handleUpdate}
          onCancel={() => setEditing(false)}
        />
      </Container>
    );
  }

  return (
    <Container size="md" py="xl">
      <Group justify="space-between" mb="lg">
        <Group>
          <Title order={2}>{item.name}</Title>
          <Badge
            color={item.status === "active" ? "green" : "gray"}
            variant="light"
            size="lg"
          >
            {item.status}
          </Badge>
        </Group>
        <Group>
          <Button variant="subtle" onClick={() => navigate("/planning/orders")}>
            Back
          </Button>
          <Button onClick={() => setEditing(true)}>Edit</Button>
          <Button color="red" variant="outline" onClick={handleDelete}>
            Delete
          </Button>
        </Group>
      </Group>

      <Card withBorder p="lg">
        <Stack gap="sm">
          <Group>
            <Text fw={600} w={120}>
              Key:
            </Text>
            <Text ff="monospace">{item.key}</Text>
          </Group>
          <Group>
            <Text fw={600} w={120}>
              Description:
            </Text>
            <Text>{item.description || "—"}</Text>
          </Group>
          <Group>
            <Text fw={600} w={120}>
              Created by:
            </Text>
            <Text>{item.createdBy}</Text>
          </Group>
          <Group>
            <Text fw={600} w={120}>
              Created at:
            </Text>
            <Text>{new Date(item.createdAt).toLocaleString()}</Text>
          </Group>
          <Group>
            <Text fw={600} w={120}>
              Updated by:
            </Text>
            <Text>{item.updatedBy}</Text>
          </Group>
          <Group>
            <Text fw={600} w={120}>
              Updated at:
            </Text>
            <Text>{new Date(item.updatedAt).toLocaleString()}</Text>
          </Group>
        </Stack>
      </Card>

      <PlanningOrderRevisions orderId={id!} />
    </Container>
  );
};
