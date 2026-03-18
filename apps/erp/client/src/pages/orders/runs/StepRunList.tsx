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
  StepRun,
  StepRunListResponse,
  UpdateStepRun,
} from "@naisys-erp/shared";
import { IconArrowBackUp } from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";

import { CompactMarkdown } from "@naisys/common-browser";
import { FieldValueRunList } from "../../../components/FieldValueList";
import { api, apiEndpoints, showErrorNotification } from "../../../lib/api";
import { hasAction } from "../../../lib/hateoas";

interface Props {
  orderKey: string;
  runNo: string;
  seqNo: string;
  refreshKey?: number;
  onStepUpdate?: () => void;
}

export const StepRunList: React.FC<Props> = ({
  orderKey,
  runNo,
  seqNo,
  refreshKey,
  onStepUpdate,
}) => {
  const [data, setData] = useState<StepRunListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingStep, setSavingStep] = useState<number | null>(null);
  const [loadedSeqNo, setLoadedSeqNo] = useState(seqNo);

  // Clear stale data when operation run changes
  if (seqNo !== loadedSeqNo) {
    setLoadedSeqNo(seqNo);
    setData(null);
    setLoading(true);
  }

  const fetchSteps = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get<StepRunListResponse>(
        apiEndpoints.stepRuns(orderKey, runNo, seqNo),
      );
      setData(result);
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setLoading(false);
    }
  }, [orderKey, runNo, seqNo, refreshKey]);

  useEffect(() => {
    void fetchSteps();
  }, [fetchSteps]);

  const saveStep = async (step: StepRun, completed: boolean) => {
    setSavingStep(step.id);

    try {
      const body: UpdateStepRun = { completed };
      const updated = await api.put<StepRun>(
        apiEndpoints.stepRun(orderKey, runNo, seqNo, step.seqNo),
        body,
      );
      setData((prev) =>
        prev
          ? {
              ...prev,
              items: prev.items.map((s) => (s.id === updated.id ? updated : s)),
            }
          : prev,
      );
      onStepUpdate?.();
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setSavingStep(null);
    }
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
                    <FieldValueRunList
                      fieldValues={step.fieldValues}
                      multiSet={step.multiSet}
                      completed={step.completed}
                      _actionTemplates={step._actionTemplates}
                      fieldValueEndpoint={(fieldSeqNo) =>
                        apiEndpoints.stepRunFieldValue(
                          orderKey,
                          runNo,
                          seqNo,
                          step.seqNo,
                          fieldSeqNo,
                        )
                      }
                      deleteSetEndpoint={(setIndex) =>
                        apiEndpoints.stepRunDeleteSet(
                          orderKey,
                          runNo,
                          seqNo,
                          step.seqNo,
                          setIndex,
                        )
                      }
                      attachmentEndpoint={(fieldSeqNo) =>
                        apiEndpoints.stepFieldAttachments(
                          orderKey,
                          runNo,
                          seqNo,
                          step.seqNo,
                          fieldSeqNo,
                        )
                      }
                      attachmentDownloadUrl={(fieldSeqNo, attachmentId) =>
                        `/api/erp/${apiEndpoints.stepFieldAttachmentDownload(
                          orderKey,
                          runNo,
                          seqNo,
                          step.seqNo,
                          fieldSeqNo,
                          attachmentId,
                        )}`
                      }
                      onSetDeleted={() => void fetchSteps()}
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
