import {
  Button,
  Card,
  Checkbox,
  Group,
  Loader,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import type {
  StepRun,
  StepRunListResponse,
  UpdateStepRun,
} from "@naisys-erp/shared";
import { useCallback, useEffect, useState } from "react";
import Markdown from "react-markdown";

import { api, apiEndpoints, showErrorNotification } from "../../../lib/api";
import { hasAction } from "../../../lib/hateoas";

interface Props {
  orderKey: string;
  runId: string;
  opRunId: string;
}

interface StepRunState {
  completed: boolean;
  fieldValues: Record<number, string>; // stepFieldId → value
}

export const StepRunList: React.FC<Props> = ({ orderKey, runId, opRunId }) => {
  const [data, setData] = useState<StepRunListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<number | null>(null);
  const [edits, setEdits] = useState<Record<number, StepRunState>>({});
  const [loadedOpRunId, setLoadedOpRunId] = useState(opRunId);

  // Clear stale data when operation run changes
  if (opRunId !== loadedOpRunId) {
    setLoadedOpRunId(opRunId);
    setData(null);
    setLoading(true);
    setEdits({});
  }

  const fetchSteps = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get<StepRunListResponse>(
        apiEndpoints.stepRuns(orderKey, runId, opRunId),
      );
      setData(result);
      // Initialize edit state from fetched data
      const newEdits: Record<number, StepRunState> = {};
      for (const step of result.items) {
        newEdits[step.id] = {
          completed: step.completed,
          fieldValues: Object.fromEntries(
            step.fieldValues.map((fv) => [fv.stepFieldId, fv.value]),
          ),
        };
      }
      setEdits(newEdits);
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setLoading(false);
    }
  }, [orderKey, runId, opRunId]);

  useEffect(() => {
    void fetchSteps();
  }, [fetchSteps]);

  const handleSave = async (step: StepRun) => {
    const edit = edits[step.id];
    if (!edit) return;
    setSaving(step.id);
    try {
      const body: UpdateStepRun = {
        completed: edit.completed,
        fieldValues: step.fieldValues.map((fv) => ({
          stepFieldId: fv.stepFieldId,
          value: edit.fieldValues[fv.stepFieldId] ?? fv.value,
        })),
      };
      await api.put(
        apiEndpoints.stepRun(orderKey, runId, opRunId, step.id),
        body,
      );
      await fetchSteps();
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setSaving(null);
    }
  };

  const updateEdit = (stepId: number, patch: Partial<StepRunState>) => {
    setEdits((prev) => ({
      ...prev,
      [stepId]: { ...prev[stepId], ...patch },
    }));
  };

  const updateFieldValue = (
    stepId: number,
    stepFieldId: number,
    value: string,
  ) => {
    setEdits((prev) => ({
      ...prev,
      [stepId]: {
        ...prev[stepId],
        fieldValues: { ...prev[stepId]?.fieldValues, [stepFieldId]: value },
      },
    }));
  };

  const isDirty = (step: StepRun): boolean => {
    const edit = edits[step.id];
    if (!edit) return false;
    if (edit.completed !== step.completed) return true;
    for (const fv of step.fieldValues) {
      if ((edit.fieldValues[fv.stepFieldId] ?? fv.value) !== fv.value)
        return true;
    }
    return false;
  };

  return (
    <>
      <Title order={5}>Steps</Title>

      {loading ? (
        <Stack align="center" py="sm">
          <Loader size="sm" />
        </Stack>
      ) : (
        <Stack gap="xs">
          {data?.items.map((step) => {
            const canUpdate = hasAction(step._actions, "update");
            const edit = edits[step.id];

            return (
              <Card key={step.id} withBorder p="sm">
                <Stack gap="xs">
                  <Group justify="space-between" align="flex-start">
                    <Text fw={600} size="sm">
                      Step {step.seqNo}
                    </Text>
                    {canUpdate && (
                      <Checkbox
                        label="Completed"
                        checked={edit?.completed ?? step.completed}
                        onChange={(e) =>
                          updateEdit(step.id, {
                            completed: e.currentTarget.checked,
                          })
                        }
                        size="xs"
                      />
                    )}
                    {!canUpdate && step.completed && (
                      <Text size="xs" c="green">
                        Completed
                      </Text>
                    )}
                  </Group>

                  {step.instructions ? (
                    <Markdown>{step.instructions}</Markdown>
                  ) : (
                    <Text size="sm" c="dimmed">
                      No instructions
                    </Text>
                  )}

                  {step.fieldValues.length > 0 && (
                    <Stack gap="xs" mt="xs">
                      <Text size="xs" fw={600} c="dimmed">
                        Data Fields
                      </Text>
                      {step.fieldValues.map((fv) => (
                        <Group key={fv.stepFieldId} gap="xs" align="flex-end">
                          {canUpdate ? (
                            <TextInput
                              label={fv.label}
                              size="xs"
                              style={{ flex: 1 }}
                              value={
                                edit?.fieldValues[fv.stepFieldId] ?? fv.value
                              }
                              onChange={(e) =>
                                updateFieldValue(
                                  step.id,
                                  fv.stepFieldId,
                                  e.currentTarget.value,
                                )
                              }
                            />
                          ) : (
                            <Group gap="xs">
                              <Text size="xs" fw={500}>
                                {fv.label}:
                              </Text>
                              <Text size="xs">{fv.value || "—"}</Text>
                            </Group>
                          )}
                        </Group>
                      ))}
                    </Stack>
                  )}

                  {canUpdate && isDirty(step) && (
                    <Group justify="flex-end" mt="xs">
                      <Button
                        size="xs"
                        loading={saving === step.id}
                        onClick={() => handleSave(step)}
                      >
                        Save
                      </Button>
                    </Group>
                  )}
                </Stack>
              </Card>
            );
          })}

          {data && data.items.length === 0 && (
            <Text size="sm" c="dimmed">
              No steps.
            </Text>
          )}
        </Stack>
      )}
    </>
  );
};
