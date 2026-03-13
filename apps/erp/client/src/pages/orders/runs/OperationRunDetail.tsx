import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Container,
  Group,
  Loader,
  Stack,
  Text,
  Textarea,
} from "@mantine/core";
import type { OperationRun } from "@naisys-erp/shared";
import { OperationRunStatus } from "@naisys-erp/shared";
import { IconArrowBackUp } from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useOutletContext, useParams } from "react-router";

import { CompactMarkdown } from "../../../components/CompactMarkdown";
import { MetadataTooltip } from "../../../components/MetadataTooltip";
import { api, apiEndpoints, showErrorNotification } from "../../../lib/api";
import { hasAction } from "../../../lib/hateoas";
import { StepRunList } from "./StepRunList";

const STATUS_COLORS: Record<string, string> = {
  pending: "gray",
  in_progress: "yellow",
  completed: "green",
  skipped: "gray",
  failed: "red",
};

export interface OrderRunOutletContext {
  onOperationUpdate: () => void;
}

export const OperationRunDetail: React.FC = () => {
  const {
    orderKey,
    id: runId,
    opRunId,
  } = useParams<{
    orderKey: string;
    id: string;
    opRunId: string;
  }>();
  const { onOperationUpdate } = useOutletContext<OrderRunOutletContext>();
  const [item, setItem] = useState<OperationRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [feedbackDraft, setFeedbackDraft] = useState("");
  const feedbackRef = useRef("");

  const fetchItem = useCallback(async () => {
    if (!orderKey || !runId || !opRunId) return;
    setLoading(true);
    try {
      const result = await api.get<OperationRun>(
        apiEndpoints.operationRun(orderKey, runId, opRunId),
      );
      setItem(result);
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setLoading(false);
    }
  }, [orderKey, runId, opRunId]);

  useEffect(() => {
    void fetchItem();
  }, [fetchItem]);

  useEffect(() => {
    const value = item?.feedback ?? "";
    setFeedbackDraft(value);
    feedbackRef.current = value;
  }, [item?.feedback]);

  const saveFeedback = async () => {
    if (!orderKey || !runId || !opRunId) return;
    const trimmed = feedbackDraft.trim();
    if (trimmed === (feedbackRef.current ?? "")) return;
    try {
      const updated = await api.put<OperationRun>(
        apiEndpoints.operationRun(orderKey, runId, opRunId),
        { feedback: trimmed || null },
      );
      setItem(updated);
    } catch (err) {
      showErrorNotification(err);
    }
  };

  const handleAction = async (
    action: "start" | "complete" | "skip" | "fail" | "reopen",
  ) => {
    if (!orderKey || !runId || !opRunId) return;
    const endpointMap = {
      start: apiEndpoints.operationRunStart,
      complete: apiEndpoints.operationRunComplete,
      skip: apiEndpoints.operationRunSkip,
      fail: apiEndpoints.operationRunFail,
      reopen: apiEndpoints.operationRunReopen,
    };
    try {
      const updated = await api.post<OperationRun>(
        endpointMap[action](orderKey, runId, opRunId),
        {},
      );
      setItem(updated);
      setRefreshKey((k) => k + 1);
      onOperationUpdate();
    } catch (err) {
      showErrorNotification(err);
    }
  };

  if (loading) {
    return (
      <Stack align="center" py="xl">
        <Loader />
      </Stack>
    );
  }

  if (!item) {
    return (
      <Stack p="md">
        <Text>Operation run not found.</Text>
      </Stack>
    );
  }

  return (
    <Container size="md" py="xl">
      <Stack gap="md">
        <Group justify="space-between">
          <Group gap="xs">
            <Text fw={600}>
              OPERATION {item.seqNo}. {item.title}
            </Text>
            <MetadataTooltip
              createdBy={item.createdBy}
              createdAt={item.createdAt}
              updatedBy={item.updatedBy}
              updatedAt={item.updatedAt}
            />
            <Badge
              color={STATUS_COLORS[item.status] ?? "gray"}
              variant="light"
              size="sm"
            >
              {item.status}
            </Badge>
          </Group>
          <Group gap="xs">
            {hasAction(item._actions, "start") && (
              <Button
                size="xs"
                color="green"
                onClick={() => handleAction("start")}
              >
                Start
              </Button>
            )}
            {hasAction(item._actions, "complete") && (
              <Button
                size="xs"
                color="green"
                onClick={() => handleAction("complete")}
              >
                Complete
              </Button>
            )}
            {hasAction(item._actions, "reopen") &&
              (() => {
                const labelMap: Record<
                  string,
                  { label: string; color: string }
                > = {
                  [OperationRunStatus.completed]: {
                    label: "Completed",
                    color: "green",
                  },
                  [OperationRunStatus.skipped]: {
                    label: "Skipped",
                    color: "gray",
                  },
                  [OperationRunStatus.failed]: {
                    label: "Failed",
                    color: "red",
                  },
                };
                const { label, color } = labelMap[item.status] ?? {
                  label: item.status,
                  color: "gray",
                };
                return (
                  <Group gap="xs" align="center">
                    <Text size="xs" c={color}>
                      {label} by {item.updatedBy} on{" "}
                      {new Date(item.updatedAt).toLocaleString()}
                    </Text>
                    <ActionIcon
                      size="xs"
                      variant="subtle"
                      color="gray"
                      onClick={() => handleAction("reopen")}
                      title={`Undo ${label.toLowerCase()}`}
                    >
                      <IconArrowBackUp size={14} />
                    </ActionIcon>
                  </Group>
                );
              })()}
            {hasAction(item._actions, "skip") && (
              <Button
                size="xs"
                color="gray"
                variant="outline"
                onClick={() => handleAction("skip")}
              >
                Skip
              </Button>
            )}
            {hasAction(item._actions, "fail") && (
              <Button
                size="xs"
                color="red"
                variant="outline"
                onClick={() => handleAction("fail")}
              >
                Fail
              </Button>
            )}
          </Group>
        </Group>

        <Card withBorder p="lg">
          <Stack gap="sm">
            {item.description && (
              <Group align="flex-start">
                <Text fw={600} w={120}>
                  Description:
                </Text>
                <CompactMarkdown>{item.description}</CompactMarkdown>
              </Group>
            )}
            {item.completedAt && (
              <Group>
                <Text fw={600} w={120}>
                  Completed At:
                </Text>
                <Text>{new Date(item.completedAt).toLocaleString()}</Text>
              </Group>
            )}
          </Stack>
        </Card>

        <StepRunList
          orderKey={orderKey!}
          runId={runId!}
          opRunId={opRunId!}
          refreshKey={refreshKey}
        />

        <Stack gap="xs">
          <Text fw={600}>Feedback</Text>
          {item.status === OperationRunStatus.in_progress ? (
            <Textarea
              autosize
              minRows={2}
              placeholder="Enter feedback..."
              value={feedbackDraft}
              onChange={(e) => setFeedbackDraft(e.currentTarget.value)}
              onBlur={() => void saveFeedback()}
            />
          ) : (
            <Text style={{ whiteSpace: "pre-wrap" }}>
              {item.feedback || "\u2014"}
            </Text>
          )}
        </Stack>
      </Stack>
    </Container>
  );
};
