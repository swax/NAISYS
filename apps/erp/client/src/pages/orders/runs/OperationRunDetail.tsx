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
import { DependencyList } from "../revs/DependencyList";
import type { OrderRunOutletContext } from "./OrderRunDetail";
import { LaborTicketList } from "./LaborTicketList";
import { StepRunList } from "./StepRunList";

const STATUS_COLORS: Record<string, string> = {
  blocked: "orange",
  pending: "gray",
  in_progress: "yellow",
  completed: "green",
  skipped: "gray",
  failed: "red",
};

export const OperationRunDetail: React.FC = () => {
  const { orderKey, runNo, seqNo } = useParams<{
    orderKey: string;
    runNo: string;
    seqNo: string;
  }>();
  const { onOperationUpdate, orderRun } =
    useOutletContext<OrderRunOutletContext>();
  const [opRun, setOpRun] = useState<OperationRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [feedbackDraft, setFeedbackDraft] = useState("");
  const feedbackRef = useRef("");

  const fetchOpRun = useCallback(async () => {
    if (!orderKey || !runNo || !seqNo) return;
    setLoading(true);
    try {
      const result = await api.get<OperationRun>(
        apiEndpoints.operationRun(orderKey, runNo, seqNo),
      );
      setOpRun(result);
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setLoading(false);
    }
  }, [orderKey, runNo, seqNo]);

  useEffect(() => {
    void fetchOpRun();
  }, [fetchOpRun]);

  useEffect(() => {
    const value = opRun?.feedback ?? "";
    setFeedbackDraft(value);
    feedbackRef.current = value;
  }, [opRun?.feedback]);

  const saveFeedback = async () => {
    if (!orderKey || !runNo || !seqNo) return;
    const trimmed = feedbackDraft.trim();
    if (trimmed === (feedbackRef.current ?? "")) return;
    try {
      const updated = await api.put<OperationRun>(
        apiEndpoints.operationRun(orderKey, runNo, seqNo),
        { feedback: trimmed || null },
      );
      setOpRun(updated);
    } catch (err) {
      showErrorNotification(err);
    }
  };

  const handleAction = async (
    action: "start" | "complete" | "skip" | "fail" | "reopen",
  ) => {
    if (!orderKey || !runNo || !seqNo) return;
    const endpointMap = {
      start: apiEndpoints.operationRunStart,
      complete: apiEndpoints.operationRunComplete,
      skip: apiEndpoints.operationRunSkip,
      fail: apiEndpoints.operationRunFail,
      reopen: apiEndpoints.operationRunReopen,
    };
    try {
      const updated = await api.post<OperationRun>(
        endpointMap[action](orderKey, runNo, seqNo),
        {},
      );
      setOpRun(updated);
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

  if (!opRun) {
    return (
      <Stack p="md">
        <Text>Operation run not found.</Text>
      </Stack>
    );
  }

  return (
    <Container size="md" py="xl" w="100%">
      <Stack gap="md">
        <Group justify="space-between">
          <Group gap="xs">
            <Text fw={600}>
              OPERATION {opRun.seqNo}. {opRun.title}
            </Text>
            <MetadataTooltip
              createdBy={opRun.createdBy}
              createdAt={opRun.createdAt}
              updatedBy={opRun.updatedBy}
              updatedAt={opRun.updatedAt}
            />
            <Badge
              color={STATUS_COLORS[opRun.status] ?? "gray"}
              variant="light"
              size="sm"
            >
              {opRun.status}
            </Badge>
          </Group>
          <Group gap="xs">
            {hasAction(opRun._actions, "start") && (
              <Button
                size="xs"
                color="green"
                onClick={() => handleAction("start")}
              >
                Start
              </Button>
            )}
            {hasAction(opRun._actions, "complete") && (
              <Button
                size="xs"
                color="green"
                onClick={() => handleAction("complete")}
              >
                Complete
              </Button>
            )}
            {hasAction(opRun._actions, "reopen") &&
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
                const { label, color } = labelMap[opRun.status] ?? {
                  label: opRun.status,
                  color: "gray",
                };
                return (
                  <Group gap="xs" align="center">
                    <Text size="xs" c={color}>
                      {label} by {opRun.updatedBy} on{" "}
                      {new Date(opRun.updatedAt).toLocaleString()}
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
            {hasAction(opRun._actions, "skip") && (
              <Button
                size="xs"
                color="gray"
                variant="outline"
                onClick={() => handleAction("skip")}
              >
                Skip
              </Button>
            )}
            {hasAction(opRun._actions, "fail") && (
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
            {opRun.description && (
              <Group align="flex-start">
                <Text fw={600} w={120}>
                  Description:
                </Text>
                <CompactMarkdown>{opRun.description}</CompactMarkdown>
              </Group>
            )}
            {opRun.completedAt && (
              <Group>
                <Text fw={600} w={120}>
                  Completed At:
                </Text>
                <Text>{new Date(opRun.completedAt).toLocaleString()}</Text>
              </Group>
            )}
          </Stack>
        </Card>

        <DependencyList
          orderKey={orderKey!}
          revNo={String(orderRun.revNo)}
          opSeqNo={seqNo!}
        />

        <LaborTicketList
          orderKey={orderKey!}
          runNo={runNo!}
          seqNo={seqNo!}
          refreshKey={refreshKey}
        />

        <StepRunList
          orderKey={orderKey!}
          runNo={runNo!}
          seqNo={seqNo!}
          refreshKey={refreshKey}
        />

        <Stack gap="xs">
          <Text fw={600}>Feedback</Text>
          {opRun.status === OperationRunStatus.in_progress ? (
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
              {opRun.feedback || "\u2014"}
            </Text>
          )}
        </Stack>
      </Stack>
    </Container>
  );
};
