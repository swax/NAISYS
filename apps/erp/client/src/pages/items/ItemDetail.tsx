import {
  Button,
  Card,
  Container,
  Group,
  Loader,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
} from "@mantine/core";
import { hasAction } from "@naisys/common";
import type { Item, UpdateItem } from "@naisys/erp-shared";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";

import { FieldDefList } from "../../components/FieldDefList";
import { MetadataTooltip } from "../../components/MetadataTooltip";
import { api, apiEndpoints, showErrorNotification } from "../../lib/api";

export const ItemDetail: React.FC = () => {
  const { key } = useParams<{ key: string }>();
  const navigate = useNavigate();
  const [item, setItem] = useState<Item | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editKey, setEditKey] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fetchItem = useCallback(async () => {
    if (!key) return;
    setLoading(true);
    try {
      const result = await api.get<Item>(apiEndpoints.item(key));
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

  const handleEdit = () => {
    if (!item) return;
    setEditKey(item.key);
    setDescription(item.description);
    setEditing(true);
  };

  const handleUpdate = async () => {
    if (!key) return;
    setSubmitting(true);
    try {
      const data: UpdateItem = { key: editKey, description };
      await api.put(apiEndpoints.item(key), data);
      setEditing(false);
      if (editKey !== key) {
        void navigate(`/items/${editKey}`, { replace: true });
      } else {
        await fetchItem();
      }
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!key || !confirm("Delete this item?")) return;
    try {
      await api.delete(apiEndpoints.item(key));
      void navigate("/items");
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
        <Text>Item not found.</Text>
      </Container>
    );
  }

  if (editing) {
    return (
      <Container size="md" py="xl">
        <Title order={2} mb="lg">
          Edit Item
        </Title>
        <Stack>
          <TextInput
            label="Key"
            description="Alphanumeric with hyphens"
            value={editKey}
            onChange={(e) => setEditKey(e.currentTarget.value)}
            required
          />
          <Textarea
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.currentTarget.value)}
            autosize
            minRows={2}
          />
          <Group justify="flex-end">
            <Button variant="subtle" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button onClick={handleUpdate} loading={submitting}>
              Save
            </Button>
          </Group>
        </Stack>
      </Container>
    );
  }

  return (
    <Container size="md" py="xl">
      <Group justify="space-between" mb="lg">
        <Group>
          <Title order={2}>{item.key}</Title>
          <MetadataTooltip
            createdBy={item.createdBy}
            createdAt={item.createdAt}
            updatedBy={item.updatedBy}
            updatedAt={item.updatedAt}
          />
        </Group>
        <Group>
          <Button variant="subtle" onClick={() => navigate("/items")}>
            Back
          </Button>
          {hasAction(item._actions, "update") && (
            <Button onClick={handleEdit}>Edit</Button>
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
              Description:
            </Text>
            <Text>{item.description || "—"}</Text>
          </Group>
        </Stack>
      </Card>

      <Group mt="lg">
        <Button
          variant="light"
          onClick={() => navigate(`/items/${item.key}/instances`)}
        >
          View Instances
        </Button>
      </Group>

      {/* Field definitions */}
      <FieldDefList
        fieldsEndpoint={apiEndpoints.itemFields(item.key)}
        fieldEndpoint={(seqNo) => apiEndpoints.itemField(item.key, seqNo)}
        initialData={item.fields}
      />
    </Container>
  );
};
