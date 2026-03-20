import {
  ActionIcon,
  Button,
  Card,
  Group,
  Loader,
  Menu,
  Modal,
  Stack,
  Text,
  Textarea,
} from "@mantine/core";
import { CompactMarkdown } from "@naisys/common-browser";
import type {
  StepRun,
  StepRunListResponse,
  UpdateStepRun,
} from "@naisys-erp/shared";
import {
  IconArrowBackUp,
  IconChevronDown,
  IconNote,
} from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";

import { FieldValueRunList } from "../../../components/FieldValueList";
import { api, apiEndpoints, showErrorNotification } from "../../../lib/api";
import { hasAction } from "../../../lib/hateoas";

interface Props {
  orderKey: string;
  runNo: string;
  seqNo: string;
  refreshKey?: number;
  onStepUpdate?: () => void;
  onCountChange?: (count: number) => void;
}

export const StepRunList: React.FC<Props> = ({
  orderKey,
  runNo,
  seqNo,
  refreshKey,
  onStepUpdate,
  onCountChange,
}) => {
  const [data, setData] = useState<StepRunListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingStep, setSavingStep] = useState<number | null>(null);
  const [loadedSeqNo, setLoadedSeqNo] = useState(seqNo);
  const [noteModalStep, setNoteModalStep] = useState<StepRun | null>(null);
  const [noteText, setNoteText] = useState("");
  const [submittingNote, setSubmittingNote] = useState(false);

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
      onCountChange?.(result.total);
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setLoading(false);
    }
  }, [orderKey, runNo, seqNo, refreshKey]);

  useEffect(() => {
    void fetchSteps();
  }, [fetchSteps]);

  const saveStep = async (
    step: StepRun,
    completed: boolean,
    completionNote?: string,
  ) => {
    setSavingStep(step.id);

    try {
      const body: UpdateStepRun = { completed, completionNote };
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

  const handleNoteSubmit = async () => {
    if (!noteModalStep) return;
    setSubmittingNote(true);
    try {
      await saveStep(noteModalStep, true, noteText.trim() || undefined);
      setNoteModalStep(null);
      setNoteText("");
    } finally {
      setSubmittingNote(false);
    }
  };

  return (
    <>
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
                      {step.title ? `: ${step.title}` : ""}
                    </Text>
                    <Group gap="xs">
                      {canUpdate && !step.completed && (
                        <Group gap={0}>
                          <Button
                            size="xs"
                            color="green"
                            loading={savingStep === step.id}
                            onClick={() => saveStep(step, true)}
                            style={{
                              borderTopRightRadius: 0,
                              borderBottomRightRadius: 0,
                            }}
                          >
                            Complete
                          </Button>
                          <Menu position="bottom-end" withinPortal>
                            <Menu.Target>
                              <Button
                                size="xs"
                                color="green"
                                px={6}
                                disabled={savingStep === step.id}
                                style={{
                                  borderTopLeftRadius: 0,
                                  borderBottomLeftRadius: 0,
                                  borderLeft: "1px solid rgba(255,255,255,0.3)",
                                }}
                              >
                                <IconChevronDown size={14} />
                              </Button>
                            </Menu.Target>
                            <Menu.Dropdown>
                              <Menu.Item
                                leftSection={<IconNote size={14} />}
                                onClick={() => {
                                  setNoteModalStep(step);
                                  setNoteText("");
                                }}
                              >
                                Complete with note
                              </Menu.Item>
                            </Menu.Dropdown>
                          </Menu>
                        </Group>
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
                          Completed by {step.updatedBy} on{" "}
                          {new Date(step.updatedAt).toLocaleString()}
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

                  {step.completionNote && (
                    <Text size="xs" c="dimmed" fs="italic">
                      Completion Note: {step.completionNote}
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

      <Modal
        opened={noteModalStep !== null}
        onClose={() => setNoteModalStep(null)}
        title="Complete with Note"
        size="sm"
      >
        <Stack gap="md">
          <Textarea
            label="Completion note"
            placeholder="Enter a note..."
            value={noteText}
            onChange={(e) => setNoteText(e.currentTarget.value)}
            autosize
            minRows={3}
            maxRows={6}
            data-autofocus
          />
          <Group justify="flex-end">
            <Button variant="subtle" onClick={() => setNoteModalStep(null)}>
              Cancel
            </Button>
            <Button
              color="green"
              onClick={handleNoteSubmit}
              loading={submittingNote}
            >
              Complete
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
};
