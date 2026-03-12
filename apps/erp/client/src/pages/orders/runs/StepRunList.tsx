import {
  ActionIcon,
  Button,
  Card,
  Group,
  Loader,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { IconArrowBackUp } from "@tabler/icons-react";
import type {
  StepRun,
  StepRunListResponse,
  UpdateStepRun,
} from "@naisys-erp/shared";
import { useCallback, useEffect, useState } from "react";
import { CompactMarkdown } from "../../../components/CompactMarkdown";
import { api, apiEndpoints, showErrorNotification } from "../../../lib/api";
import { hasAction } from "../../../lib/hateoas";

interface Props {
  orderKey: string;
  runId: string;
  opRunId: string;
  refreshKey?: number;
}

interface StepRunState {
  fieldValues: Record<number, string>; // stepFieldId → value
}

export const StepRunList: React.FC<Props> = ({ orderKey, runId, opRunId, refreshKey }) => {
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
  }, [orderKey, runId, opRunId, refreshKey]);

  useEffect(() => {
    void fetchSteps();
  }, [fetchSteps]);

  const saveStep = async (step: StepRun, completedOverride?: boolean) => {
    const edit = edits[step.id];
    if (!edit) return;
    setSaving(step.id);
    try {
      const body: UpdateStepRun = {
        completed: completedOverride ?? step.completed,
        fieldValues: step.fieldValues.map((fv) => ({
          stepFieldId: fv.stepFieldId,
          value: edit.fieldValues[fv.stepFieldId] ?? fv.value,
        })),
      };
      const updated = await api.put<StepRun>(
        apiEndpoints.stepRun(orderKey, runId, opRunId, step.id),
        body,
      );
      // Update in place instead of re-fetching
      setData((prev) =>
        prev
          ? {
              ...prev,
              items: prev.items.map((s) => (s.id === updated.id ? updated : s)),
            }
          : prev,
      );
      setEdits((prev) => ({
        ...prev,
        [updated.id]: {
          fieldValues: Object.fromEntries(
            updated.fieldValues.map((fv) => [fv.stepFieldId, fv.value]),
          ),
        },
      }));
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setSaving(null);
    }
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

  const isFieldsDirty = (step: StepRun): boolean => {
    const edit = edits[step.id];
    if (!edit) return false;
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
                      STEP {step.seqNo}
                    </Text>
                    {!canUpdate && step.completed && (
                      <Text size="xs" c="green">
                        Completed
                      </Text>
                    )}
                  </Group>

                  {step.instructions ? (
                    <CompactMarkdown>{step.instructions}</CompactMarkdown>
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

                  {canUpdate && (
                    <Group justify="flex-end" mt="xs">
                      {step.completed ? (
                        <Group gap="xs" align="center">
                          <Text size="xs" c="green">
                            Completed by {step.updatedBy} on{" "}
                            {new Date(step.updatedAt).toLocaleString()}
                          </Text>
                          <ActionIcon
                            size="xs"
                            variant="subtle"
                            color="gray"
                            loading={saving === step.id}
                            onClick={() => saveStep(step, false)}
                            title="Undo completion"
                          >
                            <IconArrowBackUp size={14} />
                          </ActionIcon>
                        </Group>
                      ) : (
                        <Button
                          size="xs"
                          color="green"
                          loading={saving === step.id}
                          onClick={() => saveStep(step, true)}
                        >
                          Complete
                        </Button>
                      )}
                      {isFieldsDirty(step) && (
                        <Button
                          size="xs"
                          loading={saving === step.id}
                          onClick={() => saveStep(step)}
                        >
                          Save
                        </Button>
                      )}
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
