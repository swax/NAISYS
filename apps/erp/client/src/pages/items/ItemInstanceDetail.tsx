import {
  Anchor,
  Button,
  Card,
  Container,
  Group,
  Loader,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import type { ItemInstance, UpdateItemInstance } from "@naisys-erp/shared";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";

import { FieldValueRunList } from "../../components/FieldValueList";
import { MetadataTooltip } from "../../components/MetadataTooltip";
import { api, apiEndpoints, showErrorNotification } from "../../lib/api";
import { hasAction } from "../../lib/hateoas";

export const ItemInstanceDetail: React.FC = () => {
  const { key, instanceId } = useParams<{ key: string; instanceId: string }>();
  const navigate = useNavigate();
  const [instance, setInstance] = useState<ItemInstance | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editingFields, setEditingFields] = useState(false);
  const [editKey, setEditKey] = useState("");
  const [editQuantity, setEditQuantity] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fetchInstance = useCallback(async () => {
    if (!key || !instanceId) return;
    setLoading(true);
    try {
      const result = await api.get<ItemInstance>(
        apiEndpoints.itemInstance(key, instanceId),
      );
      setInstance(result);
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setLoading(false);
    }
  }, [key, instanceId]);

  useEffect(() => {
    void fetchInstance();
  }, [fetchInstance]);

  const handleEdit = () => {
    if (!instance) return;
    setEditKey(instance.key);
    setEditQuantity(instance.quantity != null ? String(instance.quantity) : "");
    setEditing(true);
  };

  const handleUpdate = async () => {
    if (!key || !instanceId) return;
    setSubmitting(true);
    try {
      const data: UpdateItemInstance = {
        key: editKey,
        quantity: editQuantity ? Number(editQuantity) : null,
      };
      await api.put(apiEndpoints.itemInstance(key, instanceId), data);
      setEditing(false);
      await fetchInstance();
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!key || !instanceId || !confirm("Delete this instance?")) return;
    try {
      await api.delete(apiEndpoints.itemInstance(key, instanceId));
      void navigate(`/items/${key}/instances`);
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

  if (!instance) {
    return (
      <Container size="md" py="xl">
        <Text>Instance not found.</Text>
      </Container>
    );
  }

  if (editing) {
    return (
      <Container size="md" py="xl">
        <Title order={2} mb="lg">
          Edit Instance
        </Title>
        <Stack>
          <TextInput
            label="Key (lot/serial number)"
            value={editKey}
            onChange={(e) => setEditKey(e.currentTarget.value)}
            required
          />
          <TextInput
            label="Quantity"
            type="number"
            value={editQuantity}
            onChange={(e) => setEditQuantity(e.currentTarget.value)}
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

  const hasFieldValues = instance.fieldValues.length > 0;
  const canEditFields = hasAction(instance._actions, "update");

  return (
    <Container size="md" py="xl">
      <Group justify="space-between" mb="lg">
        <Group>
          <Title order={2}>{instance.key}</Title>
          <MetadataTooltip
            createdBy={instance.createdBy}
            createdAt={instance.createdAt}
            updatedBy={instance.updatedBy}
            updatedAt={instance.updatedAt}
          />
        </Group>
        <Group>
          <Button
            variant="subtle"
            onClick={() => navigate(`/items/${key}/instances`)}
          >
            Back
          </Button>
          {hasAction(instance._actions, "update") && (
            <Button onClick={handleEdit}>Edit</Button>
          )}
          {hasAction(instance._actions, "delete") && (
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
            <Text ff="monospace">{instance.key}</Text>
          </Group>
          <Group>
            <Text fw={600} w={120}>
              Quantity:
            </Text>
            <Text>
              {instance.quantity != null ? instance.quantity : "\u2014"}
            </Text>
          </Group>
          <Group>
            <Text fw={600} w={120}>
              Produced By:
            </Text>
            {instance.orderKey ? (
              <Anchor
                href={`/erp/orders/${instance.orderKey}/runs/${instance.orderRunNo}`}
                onClick={(e: React.MouseEvent) => {
                  if (e.button === 1 || e.ctrlKey || e.metaKey) return;
                  e.preventDefault();
                  void navigate(
                    `/orders/${instance.orderKey}/runs/${instance.orderRunNo}`,
                  );
                }}
              >
                {instance.orderKey} Order Run {instance.orderRunNo}
              </Anchor>
            ) : (
              <Text>{"\u2014"}</Text>
            )}
          </Group>
        </Stack>
      </Card>

      {hasFieldValues && (
        <Card withBorder p="lg" mt="md">
          <Group justify="space-between" mb="xs">
            <Text fw={600}>Field Values</Text>
            {canEditFields && (
              <Button
                size="xs"
                variant={editingFields ? "filled" : "light"}
                onClick={() => setEditingFields((prev) => !prev)}
              >
                {editingFields ? "Done Editing" : "Edit Fields"}
              </Button>
            )}
          </Group>
          <FieldValueRunList
            fieldValues={instance.fieldValues}
            multiSet={false}
            completed={!editingFields}
            _actionTemplates={
              editingFields ? instance._actionTemplates : undefined
            }
            fieldValueEndpoint={(fieldSeqNo, _setIndex) =>
              apiEndpoints.itemInstanceFieldValue(key!, instanceId!, fieldSeqNo)
            }
            deleteSetEndpoint={(setIndex) =>
              apiEndpoints.itemInstanceDeleteSet(key!, instanceId!, setIndex)
            }
            attachmentEndpoint={(_fieldSeqNo, _setIndex) => ""}
            attachmentDownloadUrl={() => ""}
            onSetDeleted={() => void fetchInstance()}
          />
        </Card>
      )}
    </Container>
  );
};
