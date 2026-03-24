import {
  Anchor,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  Modal,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  UnstyledButton,
} from "@mantine/core";
import type { FieldRef, FieldRefListResponse } from "@naisys-erp/shared";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";

import { api, apiEndpoints, showErrorNotification } from "../../../lib/api";
import { hasAction } from "../../../lib/hateoas";

interface AvailableStep {
  opSeqNo: number;
  opTitle: string;
  stepSeqNo: number;
  stepTitle: string;
  stepId: number;
  fieldCount: number;
}

interface FieldRefListProps {
  orderKey: string;
  revNo: string;
  opSeqNo: string;
}

export const FieldRefList: React.FC<FieldRefListProps> = ({
  orderKey,
  revNo,
  opSeqNo,
}) => {
  const [data, setData] = useState<FieldRefListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [available, setAvailable] = useState<AvailableStep[]>([]);
  const [loadingAvailable, setLoadingAvailable] = useState(false);
  const [titleInput, setTitleInput] = useState("");
  const [selected, setSelected] = useState<AvailableStep | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadedOpSeqNo, setLoadedOpSeqNo] = useState(opSeqNo);

  if (opSeqNo !== loadedOpSeqNo) {
    setLoadedOpSeqNo(opSeqNo);
    setData(null);
    setLoading(true);
  }

  const fetchRefs = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get<FieldRefListResponse>(
        apiEndpoints.orderRevOpFieldRefs(orderKey, revNo, opSeqNo),
      );
      setData(result);
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setLoading(false);
    }
  }, [orderKey, revNo, opSeqNo]);

  useEffect(() => {
    void fetchRefs();
  }, [fetchRefs]);

  const openDialog = async () => {
    setDialogOpen(true);
    setSelected(null);
    setTitleInput("");
    setLoadingAvailable(true);
    try {
      const result = await api.get<{ items: AvailableStep[] }>(
        apiEndpoints.orderRevOpFieldRefAvailable(orderKey, revNo, opSeqNo),
      );
      setAvailable(result.items);
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setLoadingAvailable(false);
    }
  };

  const handleCreate = async () => {
    if (!selected || !titleInput.trim()) return;
    setSaving(true);
    try {
      const created = await api.post<FieldRef>(
        apiEndpoints.orderRevOpFieldRefs(orderKey, revNo, opSeqNo),
        {
          title: titleInput.trim(),
          sourceOpSeqNo: selected.opSeqNo,
          sourceStepSeqNo: selected.stepSeqNo,
        },
      );
      setDialogOpen(false);
      setData((prev) =>
        prev
          ? {
              ...prev,
              items: [...prev.items, created].sort((a, b) => a.seqNo - b.seqNo),
              total: prev.total + 1,
            }
          : prev,
      );
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (ref: FieldRef) => {
    if (!data) return;
    try {
      await api.delete(
        apiEndpoints.orderRevOpFieldRef(orderKey, revNo, opSeqNo, ref.seqNo),
      );
      setData({
        ...data,
        items: data.items.filter((r) => r.id !== ref.id),
        total: data.total - 1,
      });
    } catch (err) {
      showErrorNotification(err);
    }
  };

  return (
    <>
      <Group justify="space-between">
        <Title order={5}>Referenced Fields</Title>
        {hasAction(data?._actions, "create") && (
          <Button size="xs" variant="light" onClick={openDialog}>
            Add Reference
          </Button>
        )}
      </Group>

      {loading ? (
        <Stack align="center" py="sm">
          <Loader size="sm" />
        </Stack>
      ) : (
        <Stack gap="xs">
          {data?.items.map((ref) => (
            <Card key={ref.id} withBorder p="sm">
              <Group
                justify="space-between"
                mb={ref.fields.length > 0 ? "xs" : undefined}
              >
                <Group gap="xs">
                  <Text size="sm" fw={500}>
                    {ref.title}
                  </Text>
                  <Anchor
                    component={Link}
                    to={`/orders/${orderKey}/revs/${revNo}/ops/${ref.sourceOpSeqNo}`}
                    size="xs"
                    c="dimmed"
                  >
                    Op {ref.sourceOpSeqNo} / Step {ref.sourceStepSeqNo}
                  </Anchor>
                </Group>
                {hasAction(ref._actions, "delete") && (
                  <Button
                    size="compact-xs"
                    color="red"
                    variant="subtle"
                    onClick={() => handleDelete(ref)}
                  >
                    Remove
                  </Button>
                )}
              </Group>
              {ref.fields.length > 0 && (
                <Table withRowBorders={false}>
                  <Table.Tbody>
                    {ref.fields.map((f) => (
                      <Table.Tr key={f.seqNo}>
                        <Table.Td w={40}>
                          <Text size="xs" c="dimmed">
                            {f.seqNo}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs">{f.label}</Text>
                        </Table.Td>
                        <Table.Td w={100}>
                          <Badge variant="light" size="xs">
                            {f.type}
                          </Badge>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              )}
            </Card>
          ))}

          {data && data.items.length === 0 && (
            <Text size="sm" c="dimmed">
              No referenced fields.
            </Text>
          )}
        </Stack>
      )}

      <Modal
        opened={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title="Add Field Reference"
        size="md"
      >
        <Stack gap="md">
          <TextInput
            label="Reference Title"
            placeholder="e.g. Dimensions from Inspection"
            value={titleInput}
            onChange={(e) => setTitleInput(e.currentTarget.value)}
            data-autofocus
          />

          <Text size="sm" fw={500}>
            Select a step with fields:
          </Text>

          {loadingAvailable ? (
            <Stack align="center" py="sm">
              <Loader size="sm" />
            </Stack>
          ) : available.length === 0 ? (
            <Text size="sm" c="dimmed">
              No steps with fields available to reference.
            </Text>
          ) : (
            <Stack gap="xs">
              {available.map((step) => (
                <UnstyledButton
                  key={step.stepId}
                  onClick={() => {
                    setSelected(step);
                    if (!titleInput.trim()) {
                      setTitleInput(`${step.opTitle} - ${step.stepTitle}`);
                    }
                  }}
                  style={(theme) => ({
                    padding: theme.spacing.xs,
                    borderRadius: theme.radius.sm,
                    border: `1px solid ${
                      selected?.stepId === step.stepId
                        ? theme.colors.blue[5]
                        : theme.colors.gray[3]
                    }`,
                    backgroundColor:
                      selected?.stepId === step.stepId
                        ? theme.colors.blue[0]
                        : undefined,
                  })}
                >
                  <Group gap="xs">
                    <Badge variant="light" size="sm">
                      Op {step.opSeqNo} / Step {step.stepSeqNo}
                    </Badge>
                    <Text size="sm">
                      {step.opTitle} - {step.stepTitle}
                    </Text>
                    <Text size="xs" c="dimmed">
                      ({step.fieldCount} field
                      {step.fieldCount !== 1 ? "s" : ""})
                    </Text>
                  </Group>
                </UnstyledButton>
              ))}
            </Stack>
          )}

          <Group justify="flex-end">
            <Button variant="subtle" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => void handleCreate()}
              loading={saving}
              disabled={!selected || !titleInput.trim()}
            >
              Add Reference
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
};
