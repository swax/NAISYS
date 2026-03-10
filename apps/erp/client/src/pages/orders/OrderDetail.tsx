import {
  Badge,
  Button,
  Card,
  Container,
  Group,
  Loader,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import type { Order, UpdateOrder } from "@naisys-erp/shared";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";

import { MetadataTooltip } from "../../components/MetadataTooltip";
import { OrderForm } from "../../components/OrderForm";
import { OrderRevisions } from "../../components/OrderRevisions";
import { api, apiEndpoints, showErrorNotification } from "../../lib/api";
import { hasAction } from "../../lib/hateoas";

export const OrderDetail: React.FC = () => {
  const { key } = useParams<{ key: string }>();
  const navigate = useNavigate();
  const [item, setItem] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);

  const fetchItem = useCallback(async () => {
    if (!key) return;
    setLoading(true);
    try {
      const result = await api.get<Order>(apiEndpoints.order(key));
      setItem(result);
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setLoading(false);
    }
  }, [key]);

  useEffect(() => {
    void fetchItem();
  }, [fetchItem]);

  const handleUpdate = async (data: UpdateOrder) => {
    if (!key) return;
    await api.put(apiEndpoints.order(key), data);
    setEditing(false);
    await fetchItem();
  };

  const handleDelete = async () => {
    if (!key || !confirm("Delete this order?")) return;
    try {
      await api.delete(apiEndpoints.order(key));
      void navigate("/orders");
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
        <Text>Order not found.</Text>
      </Container>
    );
  }

  if (editing) {
    return (
      <Container size="md" py="xl">
        <Title order={2} mb="lg">
          Edit Order
        </Title>
        <OrderForm<true>
          initialData={{
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
          <MetadataTooltip
            createdBy={item.createdBy}
            createdAt={item.createdAt}
            updatedBy={item.updatedBy}
            updatedAt={item.updatedAt}
          />
          <Badge
            color={item.status === "active" ? "green" : "gray"}
            variant="light"
            size="lg"
          >
            {item.status}
          </Badge>
        </Group>
        <Group>
          <Button variant="subtle" onClick={() => navigate("/orders")}>
            Back
          </Button>
          <Button
            variant="light"
            onClick={() => navigate(`/orders/${key}/runs`)}
          >
            View Runs
          </Button>
          {hasAction(item._actions, "update") && (
            <Button onClick={() => setEditing(true)}>Edit</Button>
          )}
          {hasAction(item._actions, "delete") && (
            <Button color="red" variant="outline" onClick={handleDelete}>
              Delete
            </Button>
          )}
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
        </Stack>
      </Card>

      <OrderRevisions orderKey={key!} />
    </Container>
  );
};
