import {
  Badge,
  Button,
  Card,
  Checkbox,
  Group,
  Loader,
  NumberInput,
  Stack,
  Text,
  Textarea,
  Title,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import type {
  CreateStep,
  Step,
  StepListResponse,
  UpdateStep,
} from "@naisys-erp/shared";
import { CreateStepSchema, UpdateStepSchema } from "@naisys-erp/shared";
import { useCallback, useEffect, useState } from "react";

import { CompactMarkdown } from "../../../components/CompactMarkdown";
import { FieldDefList } from "../../../components/FieldDefList";
import { MetadataTooltip } from "../../../components/MetadataTooltip";
import { api, apiEndpoints, showErrorNotification } from "../../../lib/api";
import { hasAction } from "../../../lib/hateoas";
import { zodResolver } from "../../../lib/zod-resolver";

interface StepListProps {
  orderKey: string;
  revNo: string;
  opSeqNo: string;
}

export const StepList: React.FC<StepListProps> = ({
  orderKey,
  revNo,
  opSeqNo,
}) => {
  const [steps, setSteps] = useState<StepListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingStepId, setEditingStepId] = useState<number | null>(null);
  const [addingStep, setAddingStep] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadedOpSeqNo, setLoadedOpSeqNo] = useState(opSeqNo);

  // Clear stale steps immediately when operation changes
  if (opSeqNo !== loadedOpSeqNo) {
    setLoadedOpSeqNo(opSeqNo);
    setSteps(null);
    setLoading(true);
    setEditingStepId(null);
    setAddingStep(false);
  }

  const editForm = useForm<UpdateStep>({
    initialValues: { seqNo: 10, instructions: "", multiSet: false },
    validate: zodResolver(UpdateStepSchema),
  });

  const createForm = useForm<CreateStep>({
    initialValues: { seqNo: 10, instructions: "", multiSet: false },
    validate: zodResolver(CreateStepSchema),
  });

  const fetchSteps = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get<StepListResponse>(
        apiEndpoints.orderRevOpSteps(orderKey, revNo, opSeqNo),
      );
      setSteps(result);
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setLoading(false);
    }
  }, [orderKey, revNo, opSeqNo]);

  useEffect(() => {
    void fetchSteps();
  }, [fetchSteps]);

  const startEditing = (step: Step) => {
    editForm.setValues({
      seqNo: step.seqNo,
      instructions: step.instructions,
      multiSet: step.multiSet,
    });
    setEditingStepId(step.id);
    setAddingStep(false);
  };

  const handleSave = async (values: UpdateStep) => {
    const step = steps?.items.find((s) => s.id === editingStepId);
    if (!step || !steps) return;
    setSaving(true);
    try {
      const updated = await api.put<Step>(
        apiEndpoints.orderRevOpStep(orderKey, revNo, opSeqNo, step.seqNo),
        values,
      );
      setEditingStepId(null);
      setSteps({
        ...steps,
        items: steps.items
          .map((s) => (s.id === updated.id ? updated : s))
          .sort((a, b) => a.seqNo - b.seqNo),
      });
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (step: Step) => {
    if (!steps || !confirm(`Delete step ${step.seqNo}?`)) return;
    try {
      await api.delete(
        apiEndpoints.orderRevOpStep(orderKey, revNo, opSeqNo, step.seqNo),
      );
      setSteps({
        ...steps,
        items: steps.items.filter((s) => s.id !== step.id),
        total: steps.total - 1,
      });
    } catch (err) {
      showErrorNotification(err);
    }
  };

  const startAdding = () => {
    createForm.setValues({
      seqNo: steps?.nextSeqNo ?? 10,
      instructions: "",
    });
    setAddingStep(true);
    setEditingStepId(null);
  };

  const handleCreate = async (values: CreateStep) => {
    if (!steps) return;
    setSaving(true);
    try {
      const created = await api.post<Step>(
        apiEndpoints.orderRevOpSteps(orderKey, revNo, opSeqNo),
        values,
      );
      setAddingStep(false);
      setSteps({
        ...steps,
        items: [...steps.items, created].sort((a, b) => a.seqNo - b.seqNo),
        total: steps.total + 1,
        nextSeqNo: created.seqNo + 10,
      });
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Group justify="space-between">
        <Title order={5}>Steps</Title>
        {hasAction(steps?._actions, "create") && !addingStep && (
          <Button size="xs" variant="light" onClick={startAdding}>
            Add Step
          </Button>
        )}
      </Group>

      {loading ? (
        <Stack align="center" py="sm">
          <Loader size="sm" />
        </Stack>
      ) : (
        <Stack gap="xs">
          {steps?.items.map((step) => (
            <Card key={step.id} withBorder p="sm">
              {editingStepId === step.id ? (
                <form onSubmit={editForm.onSubmit(handleSave)}>
                  <Stack gap="sm">
                    <NumberInput
                      label="Sequence #"
                      min={1}
                      step={10}
                      {...editForm.getInputProps("seqNo")}
                    />
                    <Textarea
                      label="Instructions (markdown)"
                      placeholder="Step instructions..."
                      autosize
                      minRows={3}
                      {...editForm.getInputProps("instructions")}
                    />
                    <Checkbox
                      label="Allow multiple field value sets"
                      {...editForm.getInputProps("multiSet", {
                        type: "checkbox",
                      })}
                    />
                    <Group justify="flex-end" mt="xs">
                      <Button
                        variant="subtle"
                        size="xs"
                        onClick={() => setEditingStepId(null)}
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
                <Group justify="space-between" align="flex-start" wrap="nowrap">
                  <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
                    <Group gap="xs">
                      <Text fw={600} size="sm">
                        STEP {step.seqNo}
                      </Text>
                      {step.multiSet && (
                        <Badge size="xs" variant="light" color="violet">
                          multi-set
                        </Badge>
                      )}
                    </Group>
                    {step.instructions ? (
                      <CompactMarkdown>{step.instructions}</CompactMarkdown>
                    ) : (
                      <Text size="sm" c="dimmed">
                        No instructions
                      </Text>
                    )}
                  </Stack>
                  <Group gap="xs" wrap="nowrap">
                    <MetadataTooltip
                      createdBy={step.createdBy}
                      createdAt={step.createdAt}
                      updatedBy={step.updatedBy}
                      updatedAt={step.updatedAt}
                    />
                    {hasAction(step._actions, "update") && (
                      <Button
                        size="xs"
                        variant="light"
                        onClick={() => startEditing(step)}
                      >
                        Edit
                      </Button>
                    )}
                    {hasAction(step._actions, "delete") && (
                      <Button
                        size="xs"
                        color="red"
                        variant="outline"
                        onClick={() => handleDelete(step)}
                      >
                        Delete
                      </Button>
                    )}
                  </Group>
                </Group>
              )}
              <FieldDefList
                fieldsEndpoint={apiEndpoints.orderRevOpStepFields(
                  orderKey,
                  revNo,
                  opSeqNo,
                  step.seqNo,
                )}
                fieldEndpoint={(seqNo) =>
                  apiEndpoints.orderRevOpStepField(
                    orderKey,
                    revNo,
                    opSeqNo,
                    step.seqNo,
                    seqNo,
                  )
                }
                initialData={step.fields}
              />
            </Card>
          ))}

          {steps && steps.items.length === 0 && !addingStep && (
            <Text size="sm" c="dimmed">
              No steps yet.
            </Text>
          )}

          {addingStep && (
            <Card withBorder p="sm">
              <form onSubmit={createForm.onSubmit(handleCreate)}>
                <Stack gap="sm">
                  <NumberInput
                    label="Sequence #"
                    min={1}
                    step={10}
                    {...createForm.getInputProps("seqNo")}
                  />
                  <Textarea
                    label="Instructions (markdown)"
                    placeholder="Step instructions..."
                    autosize
                    minRows={3}
                    {...createForm.getInputProps("instructions")}
                  />
                  <Checkbox
                    label="Allow multiple field value sets"
                    {...createForm.getInputProps("multiSet", {
                      type: "checkbox",
                    })}
                  />
                  <Group justify="flex-end" mt="xs">
                    <Button
                      variant="subtle"
                      size="xs"
                      onClick={() => setAddingStep(false)}
                    >
                      Cancel
                    </Button>
                    <Button type="submit" size="xs" loading={saving}>
                      Add
                    </Button>
                  </Group>
                </Stack>
              </form>
            </Card>
          )}
        </Stack>
      )}
    </>
  );
};
