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
import type { OrderRevision, UpdateOrderRevision } from "@naisys-erp/shared";
import { UpdateOrderRevisionSchema } from "@naisys-erp/shared";
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router";

import { CompactMarkdown } from "../../../components/CompactMarkdown";
import { MetadataTooltip } from "../../../components/MetadataTooltip";
import { api, apiEndpoints, showErrorNotification } from "../../../lib/api";
import { hasAction } from "../../../lib/hateoas";
import { zodResolver } from "../../../lib/zod-resolver";

export const HeaderDetail: React.FC = () => {
  const { orderKey, revNo } = useParams<{
    orderKey: string;
    revNo: string;
  }>();
  const [item, setItem] = useState<OrderRevision | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const form = useForm<UpdateOrderRevision>({
    initialValues: { description: "", changeSummary: "" },
    validate: zodResolver(UpdateOrderRevisionSchema),
  });

  const fetchItem = useCallback(async () => {
    if (!orderKey || !revNo) return;
    setLoading(true);
    try {
      const result = await api.get<OrderRevision>(
        apiEndpoints.orderRev(orderKey, revNo),
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

  const startEditing = () => {
    if (!item) return;
    form.setValues({
      description: item.description || "",
      changeSummary: item.changeSummary || "",
    });
    setEditing(true);
  };

  const handleSave = async (values: UpdateOrderRevision) => {
    if (!item) return;
    setSaving(true);
    try {
      const updated = await api.put<OrderRevision>(
        apiEndpoints.orderRev(orderKey!, revNo!),
        values,
      );
      setItem(updated);
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

  if (!item) {
    return (
      <Stack p="md">
        <Text>Revision not found.</Text>
      </Stack>
    );
  }

  const canEdit = hasAction(item._actions, "update");

  return (
    <Container size="md" py="xl" w="100%">
      <Stack gap="md">
        <Group justify="space-between">
          <Group gap="xs">
            <Text fw={600}>HEADER</Text>
            <MetadataTooltip
              createdBy={item.createdBy}
              createdAt={item.createdAt}
              updatedBy={item.updatedBy}
              updatedAt={item.updatedAt}
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
                {item.itemKey ? (
                  <Text
                    component={Link}
                    to={`/items/${item.itemKey}`}
                    size="sm"
                    c="blue"
                    style={{ textDecoration: "none" }}
                  >
                    {item.itemKey}
                  </Text>
                ) : (
                  <Text c="dimmed">None</Text>
                )}
              </div>
              <div>
                <Text size="sm" fw={500} mb={4}>
                  Description
                </Text>
                {item.description ? (
                  <CompactMarkdown>{item.description}</CompactMarkdown>
                ) : (
                  <Text c="dimmed">No description</Text>
                )}
              </div>
              <div>
                <Text size="sm" fw={500} mb={4}>
                  Change Summary
                </Text>
                {item.changeSummary ? (
                  <CompactMarkdown>{item.changeSummary}</CompactMarkdown>
                ) : (
                  <Text c="dimmed">No change summary</Text>
                )}
              </div>
            </Stack>
          )}
        </Card>
      </Stack>
    </Container>
  );
};
