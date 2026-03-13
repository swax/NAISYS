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
import type {
  StepFieldValue,
  StepRun,
  StepRunListResponse,
  UpdateStepRun,
} from "@naisys-erp/shared";
import {
  IconAlertCircle,
  IconArrowBackUp,
  IconCheck,
} from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { CompactMarkdown } from "../../../components/CompactMarkdown";
import { api, apiEndpoints, showErrorNotification } from "../../../lib/api";
import { hasAction } from "../../../lib/hateoas";

type FieldSaveStatus = "saving" | "saved" | "error";

interface Props {
  orderKey: string;
  runId: string;
  opRunId: string;
  refreshKey?: number;
}

interface StepRunState {
  fieldValues: Record<number, string>; // stepFieldId → value
}

export const StepRunList: React.FC<Props> = ({
  orderKey,
  runId,
  opRunId,
  refreshKey,
}) => {
  const [data, setData] = useState<StepRunListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingStep, setSavingStep] = useState<number | null>(null);
  const [edits, setEdits] = useState<Record<number, StepRunState>>({});
  const [loadedOpRunId, setLoadedOpRunId] = useState(opRunId);
  // key: "stepId:stepFieldId"
  const [fieldStatus, setFieldStatus] = useState<
    Record<string, FieldSaveStatus>
  >({});
  const savedTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

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

  const setFieldSaveStatus = (
    stepId: number,
    fieldIds: number[],
    status: FieldSaveStatus,
  ) => {
    const update: Record<string, FieldSaveStatus> = {};
    for (const fid of fieldIds) {
      const key = `${stepId}:${fid}`;
      update[key] = status;
      // Clear any existing saved timer
      if (savedTimers.current[key]) {
        clearTimeout(savedTimers.current[key]);
        delete savedTimers.current[key];
      }
      // Auto-clear "saved" after 1.5s
      if (status === "saved") {
        savedTimers.current[key] = setTimeout(() => {
          setFieldStatus((prev) => {
            const next = { ...prev };
            delete next[key];
            return next;
          });
          delete savedTimers.current[key];
        }, 1500);
      }
    }
    setFieldStatus((prev) => ({ ...prev, ...update }));
  };

  const applyStepUpdate = (updated: StepRun) => {
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
  };

  const saveFieldValue = async (step: StepRun, stepFieldId: number) => {
    const edit = edits[step.id];
    if (!edit) return;
    const editedValue = edit.fieldValues[stepFieldId];
    const currentValue =
      step.fieldValues.find((fv) => fv.stepFieldId === stepFieldId)?.value ??
      "";
    if (editedValue === undefined || editedValue === currentValue) return;

    setFieldSaveStatus(step.id, [stepFieldId], "saving");

    try {
      const updated = await api.put<StepFieldValue>(
        apiEndpoints.stepRunFieldValue(
          orderKey,
          runId,
          opRunId,
          step.id,
          stepFieldId,
        ),
        { value: editedValue },
      );

      // Update the field value + validation in data
      setData((prev) =>
        prev
          ? {
              ...prev,
              items: prev.items.map((s) =>
                s.id === step.id
                  ? {
                      ...s,
                      fieldValues: s.fieldValues.map((fv) =>
                        fv.stepFieldId === stepFieldId ? updated : fv,
                      ),
                    }
                  : s,
              ),
            }
          : prev,
      );
      setFieldSaveStatus(step.id, [stepFieldId], "saved");
    } catch (err) {
      showErrorNotification(err);
      setFieldSaveStatus(step.id, [stepFieldId], "error");
    }
  };

  const saveStep = async (step: StepRun, completed: boolean) => {
    setSavingStep(step.id);

    try {
      const body: UpdateStepRun = { completed };
      const updated = await api.put<StepRun>(
        apiEndpoints.stepRun(orderKey, runId, opRunId, step.id),
        body,
      );
      applyStepUpdate(updated);
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setSavingStep(null);
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
                      {step.fieldValues.map((fv) => {
                        const fKey = `${step.id}:${fv.stepFieldId}`;
                        const status = fieldStatus[fKey];
                        const fieldLabel = fv.required
                          ? `${fv.label} *`
                          : fv.label;
                        return (
                          <Group key={fv.stepFieldId} gap="xs" align="flex-end">
                            {hasAction(fv._actions, "update") && !step.completed ? (
                              <TextInput
                                label={fieldLabel}
                                size="xs"
                                style={{ flex: 1 }}
                                error={
                                  fv.validation && !fv.validation.valid
                                    ? fv.validation.error
                                    : undefined
                                }
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
                                onBlur={() =>
                                  void saveFieldValue(step, fv.stepFieldId)
                                }
                                rightSection={
                                  status === "saving" ? (
                                    <Loader size={14} />
                                  ) : status === "saved" ? (
                                    <IconCheck size={14} color="green" />
                                  ) : status === "error" ? (
                                    <IconAlertCircle size={14} color="red" />
                                  ) : null
                                }
                              />
                            ) : (
                              <Group gap="xs">
                                <Text size="xs" fw={500}>
                                  {fieldLabel}:
                                </Text>
                                <Text size="xs">{fv.value || "—"}</Text>
                                {fv.validation && !fv.validation.valid && (
                                  <Text size="xs" c="red">
                                    {fv.validation.error}
                                  </Text>
                                )}
                              </Group>
                            )}
                          </Group>
                        );
                      })}
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
                            loading={savingStep === step.id}
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
                          loading={savingStep === step.id}
                          onClick={() => saveStep(step, true)}
                        >
                          Complete
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
