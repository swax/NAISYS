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
import { hasAction } from "@naisys/common";
import type { Order, UpdateOrder } from "@naisys/erp-shared";
import { OrderStatus } from "@naisys/erp-shared";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { MetadataTooltip } from "../../components/MetadataTooltip";
import { OrderForm } from "../../components/OrderForm";
import { OrderRevisions } from "../../components/OrderRevisions";
import { api, apiEndpoints, showErrorNotification } from "../../lib/api";

export const OrderDetail: React.FC = () => {
  const { key } = useParams<{ key: string }>();
  const navigate = useNavigate();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);

  const fetchOrder = useCallback(async () => {
    if (!key) return;
    setLoading(true);
    try {
      const result = await api.get<Order>(apiEndpoints.order(key));
      setOrder(result);
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setLoading(false);
    }
  }, [key]);

  useEffect(() => {
    void fetchOrder();
  }, [fetchOrder]);

  const handleUpdate = async (data: UpdateOrder) => {
    if (!key) return;
    await api.put(apiEndpoints.order(key), data);
    setEditing(false);
    if (data.key && data.key !== key) {
      void navigate(`/orders/${data.key}`, { replace: true });
    } else {
      await fetchOrder();
    }
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

  if (!order) {
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
            key: order.key,
            description: order.description,
            status: order.status,
            itemKey: order.itemKey,
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
          <Title order={2}>{order.key}</Title>
          <MetadataTooltip
            createdBy={order.createdBy}
            createdAt={order.createdAt}
            updatedBy={order.updatedBy}
            updatedAt={order.updatedAt}
          />
          <Badge
            color={order.status === OrderStatus.active ? "green" : "gray"}
            variant="light"
            size="lg"
          >
            {order.status}
          </Badge>
        </Group>
        <Group>
          <Button variant="subtle" onClick={() => navigate("/orders")}>
            Back
          </Button>
          <Button variant="light" component={Link} to={`/orders/${key}/runs`}>
            View Runs
          </Button>
          {hasAction(order._actions, "update") && (
            <Button onClick={() => setEditing(true)}>Edit</Button>
          )}
          {hasAction(order._actions, "delete") && (
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
              Produces Item:
            </Text>
            {order.itemKey ? (
              <Text
                component={Link}
                to={`/items/${order.itemKey}`}
                c="blue"
                style={{ textDecoration: "none" }}
              >
                {order.itemKey}
              </Text>
            ) : (
              <Text>—</Text>
            )}
          </Group>
          <Group>
            <Text fw={600} w={120}>
              Description:
            </Text>
            <Text>{order.description || "—"}</Text>
          </Group>
        </Stack>
      </Card>

      <OrderRevisions orderKey={key!} />
    </Container>
  );
};
