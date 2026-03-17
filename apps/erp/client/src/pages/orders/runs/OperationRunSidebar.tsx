import { Badge, Card, Loader, Stack, Text } from "@mantine/core";
import type { OperationRunListResponse } from "@naisys-erp/shared";
import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";

import { api, apiEndpoints, showErrorNotification } from "../../../lib/api";

const STATUS_COLORS: Record<string, string> = {
  blocked: "orange",
  pending: "gray",
  in_progress: "yellow",
  completed: "green",
  skipped: "gray",
  failed: "red",
};

interface Props {
  orderKey: string;
  runNo: string;
  refreshKey?: number;
}

export const OperationRunSidebar: React.FC<Props> = ({
  orderKey,
  runNo,
  refreshKey,
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { seqNo: currentSeqNo } = useParams<{ seqNo: string }>();
  const isHeaderActive = location.pathname.endsWith("/header");
  const [data, setData] = useState<OperationRunListResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchOps = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get<OperationRunListResponse>(
        apiEndpoints.operationRuns(orderKey, runNo),
      );
      setData(result);
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setLoading(false);
    }
  }, [orderKey, runNo]);

  useEffect(() => {
    void fetchOps();
  }, [fetchOps, refreshKey]);

  return (
    <Stack gap="xs">
      <Card
        padding="sm"
        radius="md"
        withBorder
        component="a"
        href={`/erp/orders/${orderKey}/runs/${runNo}/header`}
        onClick={(e: React.MouseEvent) => {
          if (e.button === 1 || e.ctrlKey || e.metaKey) return;
          e.preventDefault();
          void navigate(`/orders/${orderKey}/runs/${runNo}/header`);
        }}
        style={{
          cursor: "pointer",
          textDecoration: "none",
          color: "inherit",
          backgroundColor: isHeaderActive
            ? "var(--mantine-color-blue-9)"
            : undefined,
        }}
      >
        <Text size="sm" fw={500}>
          Header
        </Text>
      </Card>

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
          const url = `/orders/${orderKey}/runs/${runNo}/ops/${op.seqNo}`;
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
                  currentSeqNo === String(op.seqNo)
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
