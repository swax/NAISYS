import {
  ActionIcon,
  Button,
  Card,
  Group,
  Loader,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import type {
  StepFieldValue,
  StepRun,
  StepRunListResponse,
  UpdateStepRun,
} from "@naisys-erp/shared";
import { IconArrowBackUp } from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";

import { CompactMarkdown } from "../../../components/CompactMarkdown";
import { api, apiEndpoints, showErrorNotification } from "../../../lib/api";
import { hasAction } from "../../../lib/hateoas";
import { editKey, StepFieldRunList } from "./StepFieldRunList";

interface Props {
  orderKey: string;
  runNo: string;
  seqNo: string;
  refreshKey?: number;
}

interface StepRunState {
  fieldValues: Record<string, string>; // editKey → value
}

function buildEdits(step: StepRun): StepRunState {
  return {
    fieldValues: Object.fromEntries(
      step.fieldValues.map((fv) => [
        editKey(fv.stepFieldId, fv.setIndex),
        fv.value,
      ]),
    ),
  };
}

export const StepRunList: React.FC<Props> = ({
  orderKey,
  runNo,
  seqNo,
  refreshKey,
}) => {
  const [data, setData] = useState<StepRunListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingStep, setSavingStep] = useState<number | null>(null);
  const [edits, setEdits] = useState<Record<number, StepRunState>>({});
  const [loadedSeqNo, setLoadedSeqNo] = useState(seqNo);

  // Clear stale data when operation run changes
  if (seqNo !== loadedSeqNo) {
    setLoadedSeqNo(seqNo);
    setData(null);
    setLoading(true);
    setEdits({});
  }

  const fetchSteps = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get<StepRunListResponse>(
        apiEndpoints.stepRuns(orderKey, runNo, seqNo),
      );
      setData(result);
      const newEdits: Record<number, StepRunState> = {};
      for (const step of result.items) {
        newEdits[step.id] = buildEdits(step);
      }
      setEdits(newEdits);
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setLoading(false);
    }
  }, [orderKey, runNo, seqNo, refreshKey]);

  useEffect(() => {
    void fetchSteps();
  }, [fetchSteps]);

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
      [updated.id]: buildEdits(updated),
    }));
  };

  const saveStep = async (step: StepRun, completed: boolean) => {
    setSavingStep(step.id);

    try {
      const body: UpdateStepRun = { completed };
      const updated = await api.put<StepRun>(
        apiEndpoints.stepRun(orderKey, runNo, seqNo, step.seqNo),
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
    setIndex: number,
    value: string,
  ) => {
    const key = editKey(stepFieldId, setIndex);
    setEdits((prev) => ({
      ...prev,
      [stepId]: {
        ...prev[stepId],
        fieldValues: { ...prev[stepId]?.fieldValues, [key]: value },
      },
    }));
  };

  const handleFieldSaved = (
    stepId: number,
    stepFieldId: number,
    setIndex: number,
    updated: StepFieldValue,
  ) => {
    const key = editKey(stepFieldId, setIndex);
    setData((prev) =>
      prev
        ? {
            ...prev,
            items: prev.items.map((s) => {
              if (s.id !== stepId) return s;
              // Update existing or add new field value
              const exists = s.fieldValues.some(
                (fv) =>
                  fv.stepFieldId === stepFieldId && fv.setIndex === setIndex,
              );
              return {
                ...s,
                fieldValues: exists
                  ? s.fieldValues.map((fv) =>
                      fv.stepFieldId === stepFieldId &&
                      fv.setIndex === setIndex
                        ? updated
                        : fv,
                    )
                  : [...s.fieldValues, updated],
              };
            }),
          }
        : prev,
    );
    setEdits((prev) => ({
      ...prev,
      [stepId]: {
        ...prev[stepId],
        fieldValues: {
          ...prev[stepId]?.fieldValues,
          [key]: updated.value,
        },
      },
    }));
  };

  const handleSetAdded = (stepId: number, step: StepRun) => {
    // Determine the next set index
    const maxSetIndex = step.fieldValues.reduce(
      (max, fv) => Math.max(max, fv.setIndex),
      -1,
    );
    const nextSetIndex = maxSetIndex + 1;

    // Add empty field values for the new set (client-side only until saved)
    // Get unique field definitions from set 0
    const fieldDefs = step.fieldValues.filter((fv) => fv.setIndex === 0);
    if (fieldDefs.length === 0) return;

    const newFieldValues: StepFieldValue[] = fieldDefs.map((fv) => ({
      ...fv,
      setIndex: nextSetIndex,
      value: "",
      validation: fv.required
        ? { valid: false, error: "Required" }
        : { valid: true },
    }));

    setData((prev) =>
      prev
        ? {
            ...prev,
            items: prev.items.map((s) =>
              s.id === stepId
                ? { ...s, fieldValues: [...s.fieldValues, ...newFieldValues] }
                : s,
            ),
          }
        : prev,
    );
  };

  const handleSetDeleted = (_stepId: number) => {
    // Refetch to get re-indexed data from server
    void fetchSteps();
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
                  <Group justify="space-between" align="center">
                    <Text fw={600} size="sm">
                      STEP {step.seqNo}
                    </Text>
                    <Group gap="xs">
                      {canUpdate && !step.completed && (
                        <Button
                          size="xs"
                          color="green"
                          loading={savingStep === step.id}
                          onClick={() => saveStep(step, true)}
                        >
                          Complete
                        </Button>
                      )}
                      {canUpdate && step.completed && (
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
                      )}
                      {!canUpdate && step.completed && (
                        <Text size="xs" c="green">
                          Completed
                        </Text>
                      )}
                    </Group>
                  </Group>

                  {step.instructions ? (
                    <CompactMarkdown>{step.instructions}</CompactMarkdown>
                  ) : (
                    <Text size="sm" c="dimmed">
                      No instructions
                    </Text>
                  )}

                  {step.fieldValues.length > 0 && (
                    <StepFieldRunList
                      orderKey={orderKey}
                      runNo={runNo}
                      seqNo={seqNo}
                      step={step}
                      edits={edit?.fieldValues ?? {}}
                      onFieldChange={(stepFieldId, setIndex, value) =>
                        updateFieldValue(step.id, stepFieldId, setIndex, value)
                      }
                      onFieldSaved={(stepFieldId, setIndex, updated) =>
                        handleFieldSaved(
                          step.id,
                          stepFieldId,
                          setIndex,
                          updated,
                        )
                      }
                      onSetAdded={() => handleSetAdded(step.id, step)}
                      onSetDeleted={() => handleSetDeleted(step.id)}
                    />
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
