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
import { StepFieldRunList } from "./StepFieldRunList";

interface Props {
  orderKey: string;
  runNo: string;
  seqNo: string;
  refreshKey?: number;
}

interface StepRunState {
  fieldValues: Record<number, string>; // stepFieldId → value
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
      [updated.id]: {
        fieldValues: Object.fromEntries(
          updated.fieldValues.map((fv) => [fv.stepFieldId, fv.value]),
        ),
      },
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

  const handleFieldSaved = (
    stepId: number,
    stepFieldId: number,
    updated: StepFieldValue,
  ) => {
    setData((prev) =>
      prev
        ? {
            ...prev,
            items: prev.items.map((s) =>
              s.id === stepId
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
                    <StepFieldRunList
                      orderKey={orderKey}
                      runNo={runNo}
                      seqNo={seqNo}
                      step={step}
                      edits={edit?.fieldValues ?? {}}
                      onFieldChange={(stepFieldId, value) =>
                        updateFieldValue(step.id, stepFieldId, value)
                      }
                      onFieldSaved={(stepFieldId, updated) =>
                        handleFieldSaved(step.id, stepFieldId, updated)
                      }
                    />
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
