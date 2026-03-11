import { Badge, Card, Loader, Stack, Text } from "@mantine/core";
import type { OperationRunListResponse } from "@naisys-erp/shared";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";

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
  const navigate = useNavigate();
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

  // Auto-navigate to first operation run when none is selected
  useEffect(() => {
    if (!currentOpRunId && data && data.items.length > 0) {
      void navigate(
        `/orders/${orderKey}/runs/${runId}/ops/${data.items[0].id}`,
        { replace: true },
      );
    }
  }, [currentOpRunId, data, navigate, orderKey, runId]);

  return (
    <Stack gap="xs">
      {loading ? (
        <Stack align="center" py="md">
          <Loader size="sm" />
        </Stack>
      ) : !data || data.items.length === 0 ? (
        <Text c="dimmed" size="sm" ta="center" py="md">
          No operation runs yet.
        </Text>
      ) : (
        data.items.map((op) => {
          const url = `/orders/${orderKey}/runs/${runId}/ops/${op.id}`;
          return (
            <Card
              key={op.id}
              padding="sm"
              radius="md"
              withBorder
              component="a"
              href={`/erp${url}`}
              onClick={(e: React.MouseEvent) => {
                if (e.button === 1 || e.ctrlKey || e.metaKey) return;
                e.preventDefault();
                void navigate(url);
              }}
              style={{
                cursor: "pointer",
                textDecoration: "none",
                color: "inherit",
                backgroundColor:
                  currentOpRunId === String(op.id)
                    ? "var(--mantine-color-blue-9)"
                    : undefined,
              }}
            >
              <Text size="sm" fw={500}>
                {op.seqNo}. {op.title}
              </Text>
              <Badge
                color={STATUS_COLORS[op.status] ?? "gray"}
                variant="light"
                size="xs"
                mt={4}
              >
                {op.status}
              </Badge>
            </Card>
          );
        })
      )}
    </Stack>
  );
};
