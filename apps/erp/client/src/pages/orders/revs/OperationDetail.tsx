import {
  Button,
  Card,
  Container,
  Group,
  Loader,
  NumberInput,
  Stack,
  Text,
  Textarea,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import type { Operation, UpdateOperation } from "@naisys-erp/shared";
import { UpdateOperationSchema } from "@naisys-erp/shared";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";

import { CompactMarkdown } from "../../../components/CompactMarkdown";
import { MetadataTooltip } from "../../../components/MetadataTooltip";
import { api, apiEndpoints, showErrorNotification } from "../../../lib/api";
import { hasAction } from "../../../lib/hateoas";
import { zodResolver } from "../../../lib/zod-resolver";
import { StepList } from "./StepList";

export const OperationDetail: React.FC = () => {
  const { orderKey, revNo, seqNo } = useParams<{
    orderKey: string;
    revNo: string;
    seqNo: string;
  }>();
  const navigate = useNavigate();
  const [item, setItem] = useState<Operation | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const form = useForm<UpdateOperation>({
    initialValues: { description: "", seqNo: 10 },
    validate: zodResolver(UpdateOperationSchema),
  });

  const fetchItem = useCallback(async () => {
    if (!orderKey || !revNo || !seqNo) return;
    setLoading(true);
    try {
      const result = await api.get<Operation>(
        apiEndpoints.orderRevOp(orderKey, revNo, seqNo),
      );
      setItem(result);
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setLoading(false);
    }
  }, [orderKey, revNo, seqNo]);

  useEffect(() => {
    void fetchItem();
  }, [fetchItem]);

  const startEditing = () => {
    if (!item) return;
    form.setValues({
      description: item.description,
      seqNo: item.seqNo,
    });
    setEditing(true);
  };

  const handleSave = async (values: UpdateOperation) => {
    if (!item) return;
    setSaving(true);
    try {
      const updated = await api.put<Operation>(
        apiEndpoints.orderRevOp(orderKey!, revNo!, item.seqNo),
        values,
      );
      setItem(updated);
      setEditing(false);
      // If seqNo changed, navigate to the new URL
      if (values.seqNo && values.seqNo !== item.seqNo) {
        void navigate(
          `/orders/${orderKey}/revs/${revNo}/ops/${updated.seqNo}`,
          { replace: true },
        );
      }
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!item || !confirm(`Delete operation "${item.title}"?`)) return;
    try {
      await api.delete(apiEndpoints.orderRevOp(orderKey!, revNo!, item.seqNo));
      void navigate(`/orders/${orderKey}/revs/${revNo}`);
    } catch (err) {
      showErrorNotification(err);
    }
  };

  if (loading) {
    return (
      <Stack align="center" py="xl">
        <Loader />
      </Stack>
    );
  }

  if (!item) {
    return (
      <Stack p="md">
        <Text>Operation not found.</Text>
      </Stack>
    );
  }

  const canEdit = hasAction(item._actions, "update");

  return (
    <Container size="md" py="xl">
      <Stack gap="md">
      <Group justify="space-between">
        <Group gap="xs">
          <Text fw={600}>
            OPERATION {item.seqNo}. {item.title}
          </Text>
          <MetadataTooltip
            createdBy={item.createdBy}
            createdAt={item.createdAt}
            updatedBy={item.updatedBy}
            updatedAt={item.updatedAt}
          />
        </Group>
        <Group gap="xs">
          {canEdit && !editing && (
            <Button size="xs" variant="light" onClick={startEditing}>
              Edit
            </Button>
          )}
          {hasAction(item._actions, "delete") && (
            <Button
              size="xs"
              color="red"
              variant="outline"
              onClick={handleDelete}
            >
              Delete
            </Button>
          )}
        </Group>
      </Group>

      <Card withBorder p="lg">
        {editing ? (
          <form onSubmit={form.onSubmit(handleSave)}>
            <Stack gap="sm">
              <NumberInput
                label="Sequence #"
                min={1}
                step={10}
                {...form.getInputProps("seqNo")}
              />
              <Textarea
                label="Description"
                placeholder="Operation description..."
                minRows={3}
                {...form.getInputProps("description")}
              />
              <Group justify="flex-end" mt="xs">
                <Button
                  variant="subtle"
                  size="xs"
                  onClick={() => setEditing(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" size="xs" loading={saving}>
                  Save
                </Button>
              </Group>
            </Stack>
          </form>
        ) : (
          item.description ? (
            <CompactMarkdown>{item.description}</CompactMarkdown>
          ) : (
            <Text c="dimmed">No description</Text>
          )
        )}
      </Card>

      <StepList orderKey={orderKey!} revNo={revNo!} opSeqNo={seqNo!} />
      </Stack>
    </Container>
  );
};
