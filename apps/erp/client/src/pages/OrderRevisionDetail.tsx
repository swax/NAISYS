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
import type { OrderRevision } from "@naisys-erp/shared";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";

import { api, showErrorNotification } from "../lib/api";
import { hasAction } from "../lib/hateoas";

const STATUS_COLORS: Record<string, string> = {
  draft: "blue",
  approved: "green",
  obsolete: "gray",
};

export const OrderRevisionDetail: React.FC = () => {
  const { orderKey, revNo } = useParams<{ orderKey: string; revNo: string }>();
  const navigate = useNavigate();
  const [item, setItem] = useState<OrderRevision | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchItem = useCallback(async () => {
    if (!orderKey || !revNo) return;
    setLoading(true);
    try {
      const result = await api.get<OrderRevision>(
        `orders/${orderKey}/revs/${revNo}`,
      );
      setItem(result);
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setLoading(false);
    }
  }, [orderKey, revNo]);

  useEffect(() => {
    void fetchItem();
  }, [fetchItem]);

  const handleApprove = async () => {
    if (!confirm(`Approve revision #${revNo}?`)) return;
    try {
      await api.post(
        `orders/${orderKey}/revs/${revNo}/approve`,
        {},
      );
      await fetchItem();
    } catch (err) {
      showErrorNotification(err);
    }
  };

  const handleObsolete = async () => {
    if (!confirm(`Mark revision #${revNo} as obsolete?`)) return;
    try {
      await api.post(
        `orders/${orderKey}/revs/${revNo}/obsolete`,
        {},
      );
      await fetchItem();
    } catch (err) {
      showErrorNotification(err);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete revision #${revNo}?`)) return;
    try {
      await api.delete(`orders/${orderKey}/revs/${revNo}`);
      void navigate(`/orders/${orderKey}`);
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
        <Text>Revision not found.</Text>
      </Container>
    );
  }

  return (
    <Container size="md" py="xl">
      <Group justify="space-between" mb="lg">
        <Group>
          <Title order={2}>Revision #{item.revNo}</Title>
          <Badge
            color={STATUS_COLORS[item.status] ?? "gray"}
            variant="light"
            size="lg"
          >
            {item.status}
          </Badge>
        </Group>
        <Group>
          <Button
            variant="subtle"
            onClick={() => navigate(`/orders/${orderKey}`)}
          >
            Back to Order
          </Button>
          {hasAction(item._actions, "approve") && (
            <Button color="green" onClick={handleApprove}>
              Approve
            </Button>
          )}
          {hasAction(item._actions, "delete") && (
            <Button color="red" variant="outline" onClick={handleDelete}>
              Delete
            </Button>
          )}
          {hasAction(item._actions, "cut-order") && (
            <Button
              color="teal"
              onClick={() =>
                navigate(
                  `/orders/${orderKey}/runs/new?orderRevId=${item.id}`,
                )
              }
            >
              Cut Order
            </Button>
          )}
          {hasAction(item._actions, "obsolete") && (
            <Button color="gray" variant="outline" onClick={handleObsolete}>
              Mark Obsolete
            </Button>
          )}
        </Group>
      </Group>

      <Card withBorder p="lg">
        <Stack gap="sm">
          <Group>
            <Text fw={600} w={140}>
              Notes:
            </Text>
            <Text>{item.notes || "—"}</Text>
          </Group>
          <Group>
            <Text fw={600} w={140}>
              Change Summary:
            </Text>
            <Text>{item.changeSummary || "—"}</Text>
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
