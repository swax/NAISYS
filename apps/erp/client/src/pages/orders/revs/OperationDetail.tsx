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
  TextInput,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import type { Operation, UpdateOperation } from "@naisys-erp/shared";
import { UpdateOperationSchema } from "@naisys-erp/shared";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useOutletContext, useParams } from "react-router";

import { CompactMarkdown } from "@naisys/common-browser";
import { MetadataTooltip } from "../../../components/MetadataTooltip";
import { api, apiEndpoints, showErrorNotification } from "../../../lib/api";
import { hasAction } from "../../../lib/hateoas";
import { zodResolver } from "@naisys/common-browser";
import { DependencyList } from "./DependencyList";
import type { RevisionOutletContext } from "./RevisionLayout";
import { StepList } from "./StepList";

export const OperationDetail: React.FC = () => {
  const { orderKey, revNo, seqNo } = useParams<{
    orderKey: string;
    revNo: string;
    seqNo: string;
  }>();
  const navigate = useNavigate();
  const { onOperationUpdate } = useOutletContext<RevisionOutletContext>();
  const [operation, setOperation] = useState<Operation | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const form = useForm<UpdateOperation>({
    initialValues: { title: "", description: "", seqNo: 10 },
    validate: zodResolver(UpdateOperationSchema),
  });

  const fetchOperation = useCallback(async () => {
    if (!orderKey || !revNo || !seqNo) return;
    setLoading(true);
    try {
      const result = await api.get<Operation>(
        apiEndpoints.orderRevOp(orderKey, revNo, seqNo),
      );
      setOperation(result);
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setLoading(false);
    }
  }, [orderKey, revNo, seqNo]);

  useEffect(() => {
    void fetchOperation();
  }, [fetchOperation]);

  const startEditing = () => {
    if (!operation) return;
    form.setValues({
      title: operation.title,
      description: operation.description,
      seqNo: operation.seqNo,
    });
    setEditing(true);
  };

  const handleSave = async (values: UpdateOperation) => {
    if (!operation) return;
    setSaving(true);
    try {
      const updated = await api.put<Operation>(
        apiEndpoints.orderRevOp(orderKey!, revNo!, operation.seqNo),
        values,
      );
      setOperation(updated);
      setEditing(false);
      onOperationUpdate();
      // If seqNo changed, navigate to the new URL
      if (values.seqNo && values.seqNo !== operation.seqNo) {
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
    if (!operation || !confirm(`Delete operation "${operation.title}"?`))
      return;
    try {
      await api.delete(
        apiEndpoints.orderRevOp(orderKey!, revNo!, operation.seqNo),
      );
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

  if (!operation) {
    return (
      <Stack p="md">
        <Text>Operation not found.</Text>
      </Stack>
    );
  }

  const canEdit = hasAction(operation._actions, "update");

  return (
    <Container size="md" py="xl" w="100%">
      <Stack gap="md">
        <Group justify="space-between">
          <Group gap="xs">
            <Text fw={600}>
              OPERATION {operation.seqNo}: {operation.title}
            </Text>
            <MetadataTooltip
              createdBy={operation.createdBy}
              createdAt={operation.createdAt}
              updatedBy={operation.updatedBy}
              updatedAt={operation.updatedAt}
            />
          </Group>
          <Group gap="xs">
            {canEdit && !editing && (
              <Button size="xs" variant="light" onClick={startEditing}>
                Edit
              </Button>
            )}
            {hasAction(operation._actions, "delete") && (
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
                <TextInput
                  label="Title"
                  placeholder="Operation title..."
                  {...form.getInputProps("title")}
                />
                <NumberInput
                  label="Sequence #"
                  min={1}
                  step={10}
                  {...form.getInputProps("seqNo")}
                />
                <Textarea
                  label="Description"
                  placeholder="Operation description..."
                  autosize
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
          ) : operation.description ? (
            <CompactMarkdown>{operation.description}</CompactMarkdown>
          ) : (
            <Text c="dimmed">No description</Text>
          )}
        </Card>

        <DependencyList orderKey={orderKey!} revNo={revNo!} opSeqNo={seqNo!} />

        <StepList orderKey={orderKey!} revNo={revNo!} opSeqNo={seqNo!} />
      </Stack>
    </Container>
  );
};
