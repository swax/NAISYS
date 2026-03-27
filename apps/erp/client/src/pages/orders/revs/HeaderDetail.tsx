import {
  Button,
  Card,
  Container,
  Group,
  Loader,
  Stack,
  Text,
  Textarea,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { CompactMarkdown } from "@naisys/common-browser";
import { zodResolver } from "@naisys/common-browser";
import type {
  OperationListResponse,
  OrderRevision,
  UpdateOrderRevision,
} from "@naisys-erp/shared";
import { UpdateOrderRevisionSchema } from "@naisys-erp/shared";
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router";

import { MetadataTooltip } from "../../../components/MetadataTooltip";
import { OperationSummaryTable } from "../../../components/OperationSummaryTable";
import { api, apiEndpoints, showErrorNotification } from "../../../lib/api";
import { hasAction } from "../../../lib/hateoas";

export const HeaderDetail: React.FC = () => {
  const { orderKey, revNo } = useParams<{
    orderKey: string;
    revNo: string;
  }>();
  const [revision, setRevision] = useState<OrderRevision | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const form = useForm<UpdateOrderRevision>({
    initialValues: { description: "", changeSummary: "" },
    validate: zodResolver(UpdateOrderRevisionSchema),
  });

  const [operations, setOperations] = useState<OperationListResponse | null>(
    null,
  );
  const [opsLoading, setOpsLoading] = useState(true);

  const fetchRevision = useCallback(async () => {
    if (!orderKey || !revNo) return;
    setLoading(true);
    try {
      const result = await api.get<OrderRevision>(
        apiEndpoints.orderRev(orderKey, revNo),
      );
      setRevision(result);
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setLoading(false);
    }
  }, [orderKey, revNo]);

  const fetchOperations = useCallback(async () => {
    if (!orderKey || !revNo) return;
    setOpsLoading(true);
    try {
      const result = await api.get<OperationListResponse>(
        apiEndpoints.orderRevOps(orderKey, revNo),
      );
      setOperations(result);
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setOpsLoading(false);
    }
  }, [orderKey, revNo]);

  useEffect(() => {
    void fetchRevision();
    void fetchOperations();
  }, [fetchRevision, fetchOperations]);

  const startEditing = () => {
    if (!revision) return;
    form.setValues({
      description: revision.description || "",
      changeSummary: revision.changeSummary || "",
    });
    setEditing(true);
  };

  const handleSave = async (values: UpdateOrderRevision) => {
    if (!revision) return;
    setSaving(true);
    try {
      const updated = await api.put<OrderRevision>(
        apiEndpoints.orderRev(orderKey!, revNo!),
        values,
      );
      setRevision(updated);
      setEditing(false);
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Stack align="center" py="xl">
        <Loader />
      </Stack>
    );
  }

  if (!revision) {
    return (
      <Stack p="md">
        <Text>Revision not found.</Text>
      </Stack>
    );
  }

  const canEdit = hasAction(revision._actions, "update");

  return (
    <Container size="md" py="xl" w="100%">
      <Stack gap="md">
        <Group justify="space-between">
          <Group gap="xs">
            <Text fw={600}>HEADER</Text>
            <MetadataTooltip
              createdBy={revision.createdBy}
              createdAt={revision.createdAt}
              updatedBy={revision.updatedBy}
              updatedAt={revision.updatedAt}
            />
          </Group>
          {canEdit && !editing && (
            <Button size="xs" variant="light" onClick={startEditing}>
              Edit
            </Button>
          )}
        </Group>

        <Card withBorder p="lg">
          {editing ? (
            <form onSubmit={form.onSubmit(handleSave)}>
              <Stack gap="sm">
                <Textarea
                  label="Description"
                  placeholder="Revision description..."
                  autosize
                  minRows={3}
                  {...form.getInputProps("description")}
                />
                <Textarea
                  label="Change Summary"
                  placeholder="What changed in this revision..."
                  autosize
                  minRows={3}
                  {...form.getInputProps("changeSummary")}
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
            <Stack gap="md">
              <div>
                <Text size="sm" fw={500} mb={4}>
                  Produces Item
                </Text>
                {revision.itemKey ? (
                  <Text
                    component={Link}
                    to={`/items/${revision.itemKey}`}
                    size="sm"
                    c="blue"
                    style={{ textDecoration: "none" }}
                  >
                    {revision.itemKey}
                  </Text>
                ) : (
                  <Text c="dimmed">None</Text>
                )}
              </div>
              <div>
                <Text size="sm" fw={500} mb={4}>
                  Description
                </Text>
                {revision.description ? (
                  <CompactMarkdown>{revision.description}</CompactMarkdown>
                ) : (
                  <Text c="dimmed">No description</Text>
                )}
              </div>
              <div>
                <Text size="sm" fw={500} mb={4}>
                  Change Summary
                </Text>
                {revision.changeSummary ? (
                  <CompactMarkdown>{revision.changeSummary}</CompactMarkdown>
                ) : (
                  <Text c="dimmed">No change summary</Text>
                )}
                {Number(revNo) > 1 && (
                  <Text
                    component={Link}
                    to={`/orders/${orderKey}/revs/diff?from=${Number(revNo) - 1}&to=${revNo}`}
                    size="xs"
                    c="blue"
                    mt="xs"
                    style={{ textDecoration: "none", display: "inline-block" }}
                  >
                    Diff with previous revision
                  </Text>
                )}
              </div>
            </Stack>
          )}
        </Card>

        <OperationSummaryTable
          items={operations?.items ?? null}
          loading={opsLoading}
          linkBuilder={(seqNo) =>
            `/orders/${orderKey}/revs/${revNo}/ops/${seqNo}`
          }
        />
      </Stack>
    </Container>
  );
};
