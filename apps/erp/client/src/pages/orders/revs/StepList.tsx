import {
  Button,
  Card,
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
import Markdown from "react-markdown";

import { MetadataTooltip } from "../../../components/MetadataTooltip";
import { api, apiEndpoints, showErrorNotification } from "../../../lib/api";
import { hasAction } from "../../../lib/hateoas";
import { zodResolver } from "../../../lib/zod-resolver";
import { StepFieldList } from "./StepFieldList";

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
    initialValues: { seqNo: 10, instructions: "" },
    validate: zodResolver(UpdateStepSchema),
  });

  const createForm = useForm<CreateStep>({
    initialValues: { seqNo: 10, instructions: "" },
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
    });
    setEditingStepId(step.id);
    setAddingStep(false);
  };

  const handleSave = async (values: UpdateStep) => {
    const step = steps?.items.find((s) => s.id === editingStepId);
    if (!step) return;
    setSaving(true);
    try {
      await api.put<Step>(
        apiEndpoints.orderRevOpStep(orderKey, revNo, opSeqNo, step.seqNo),
        values,
      );
      setEditingStepId(null);
      await fetchSteps();
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (step: Step) => {
    if (!confirm(`Delete step ${step.seqNo}?`)) return;
    try {
      await api.delete(
        apiEndpoints.orderRevOpStep(orderKey, revNo, opSeqNo, step.seqNo),
      );
      await fetchSteps();
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
    setSaving(true);
    try {
      await api.post<Step>(
        apiEndpoints.orderRevOpSteps(orderKey, revNo, opSeqNo),
        values,
      );
      setAddingStep(false);
      await fetchSteps();
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
                      minRows={3}
                      {...editForm.getInputProps("instructions")}
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
                    <Text fw={600} size="sm">
                      Step {step.seqNo}
                    </Text>
                    {step.instructions ? (
                      <Markdown>{step.instructions}</Markdown>
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
              <StepFieldList
                orderKey={orderKey}
                revNo={revNo}
                opSeqNo={opSeqNo}
                stepSeqNo={step.seqNo}
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
                    minRows={3}
                    {...createForm.getInputProps("instructions")}
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
