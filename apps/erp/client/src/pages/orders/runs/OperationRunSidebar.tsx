import { Badge, Loader, NavLink, Stack, Text } from "@mantine/core";
import type { OperationRunListResponse } from "@naisys-erp/shared";
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router";

import { api, apiEndpoints, showErrorNotification } from "../../../lib/api";

const STATUS_COLORS: Record<string, string> = {
  pending: "gray",
  in_progress: "yellow",
  completed: "green",
  skipped: "gray",
  failed: "red",
};

interface Props {
  orderKey: string;
  runId: string;
}

export const OperationRunSidebar: React.FC<Props> = ({ orderKey, runId }) => {
  const { opRunId: currentOpRunId } = useParams<{ opRunId: string }>();
  const [data, setData] = useState<OperationRunListResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchOps = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get<OperationRunListResponse>(
        apiEndpoints.operationRuns(orderKey, runId),
      );
      setData(result);
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setLoading(false);
    }
  }, [orderKey, runId]);

  useEffect(() => {
    void fetchOps();
  }, [fetchOps]);

  return (
    <Stack gap={0}>
      {loading ? (
        <Stack align="center" py="md">
          <Loader size="sm" />
        </Stack>
      ) : !data || data.items.length === 0 ? (
        <Text c="dimmed" size="sm" ta="center" py="md">
          No operation runs yet.
        </Text>
      ) : (
        data.items.map((op) => (
          <NavLink
            key={op.id}
            component={Link}
            to={`/orders/${orderKey}/runs/${runId}/ops/${op.id}`}
            label={`${op.seqNo}. ${op.title}`}
            active={currentOpRunId === String(op.id)}
            rightSection={
              <Badge
                color={STATUS_COLORS[op.status] ?? "gray"}
                variant="light"
                size="xs"
              >
                {op.status}
              </Badge>
            }
          />
        ))
      )}
    </Stack>
  );
};
