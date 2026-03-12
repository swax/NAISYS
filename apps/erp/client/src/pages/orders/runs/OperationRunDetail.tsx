import {
  Badge,
  Button,
  Card,
  Group,
  Loader,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import type { OperationRun } from "@naisys-erp/shared";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router";

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
  const [item, setItem] = useState<OperationRun | null>(null);
  const [loading, setLoading] = useState(true);

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

  const handleAction = async (
    action: "start" | "complete" | "skip" | "fail",
  ) => {
    if (!orderKey || !runId || !opRunId) return;
    const endpointMap = {
      start: apiEndpoints.operationRunStart,
      complete: apiEndpoints.operationRunComplete,
      skip: apiEndpoints.operationRunSkip,
      fail: apiEndpoints.operationRunFail,
    };
    try {
      await api.post(endpointMap[action](orderKey, runId, opRunId), {});
      await fetchItem();
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
    <Stack p="md" gap="md">
      <Group justify="space-between">
        <Group gap="xs">
          <Title order={4}>
            {item.seqNo}. {item.title}
          </Title>
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
          <Group>
            <Text fw={600} w={120}>
              Seq #:
            </Text>
            <Text>{item.seqNo}</Text>
          </Group>
          <Group>
            <Text fw={600} w={120}>
              Status:
            </Text>
            <Badge color={STATUS_COLORS[item.status] ?? "gray"} variant="light">
              {item.status}
            </Badge>
          </Group>
          {item.completedAt && (
            <Group>
              <Text fw={600} w={120}>
                Completed At:
              </Text>
              <Text>{new Date(item.completedAt).toLocaleString()}</Text>
            </Group>
          )}
          <Group align="flex-start">
            <Text fw={600} w={120}>
              Notes:
            </Text>
            <Text style={{ whiteSpace: "pre-wrap" }}>
              {item.notes || "\u2014"}
            </Text>
          </Group>
        </Stack>
      </Card>

      <StepRunList orderKey={orderKey!} runId={runId!} opRunId={opRunId!} />
    </Stack>
  );
};
