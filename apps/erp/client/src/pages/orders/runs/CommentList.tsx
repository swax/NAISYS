import {
  Badge,
  Button,
  Card,
  Group,
  Loader,
  Select,
  Stack,
  Text,
  Textarea,
} from "@mantine/core";
import { hasAction } from "@naisys/common";
import type {
  OperationRunComment,
  OperationRunCommentListResponse,
} from "@naisys/erp-shared";
import { useCallback, useEffect, useState } from "react";

import { api, apiEndpoints, showErrorNotification } from "../../../lib/api";

const TYPE_COLORS: Record<string, string> = {
  note: "blue",
  issue: "red",
  feedback: "green",
};

interface Props {
  orderKey: string;
  runNo: string;
  seqNo: string;
  refreshKey?: number;
  onCountChange?: (count: number) => void;
}

export const CommentList: React.FC<Props> = ({
  orderKey,
  runNo,
  seqNo,
  refreshKey,
  onCountChange,
}) => {
  const [data, setData] = useState<OperationRunCommentListResponse | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState("");
  const [type, setType] = useState<string>("note");
  const [submitting, setSubmitting] = useState(false);
  const [loadedSeqNo, setLoadedSeqNo] = useState(seqNo);

  if (seqNo !== loadedSeqNo) {
    setLoadedSeqNo(seqNo);
    setData(null);
    setLoading(true);
  }

  const fetchComments = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get<OperationRunCommentListResponse>(
        apiEndpoints.operationRunComments(orderKey, runNo, seqNo),
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
    void fetchComments();
  }, [fetchComments]);

  const handleSubmit = async () => {
    if (!body.trim()) return;
    setSubmitting(true);
    try {
      const comment = await api.post<OperationRunComment>(
        apiEndpoints.operationRunComments(orderKey, runNo, seqNo),
        { type, body: body.trim() },
      );
      setData((prev) =>
        prev
          ? {
              ...prev,
              items: [...prev.items, comment],
              total: prev.total + 1,
            }
          : prev,
      );
      onCountChange?.((data?.total ?? 0) + 1);
      setBody("");
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setSubmitting(false);
    }
  };

  const canCreate = data?._actions && hasAction(data._actions, "create");

  if (loading) {
    return (
      <Stack align="center" py="sm">
        <Loader size="sm" />
      </Stack>
    );
  }

  return (
    <Stack gap="xs">
      {data?.items.map((comment) => (
        <Card key={comment.id} withBorder p="sm">
          <Group justify="space-between" align="flex-start" mb={4}>
            <Group gap="xs">
              <Text size="sm" fw={600}>
                {comment.createdBy}
              </Text>
              <Badge
                color={TYPE_COLORS[comment.type] ?? "gray"}
                variant="light"
                size="xs"
              >
                {comment.type}
              </Badge>
            </Group>
            <Text size="xs" c="dimmed">
              {new Date(comment.createdAt).toLocaleString()}
            </Text>
          </Group>
          <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
            {comment.body}
          </Text>
        </Card>
      ))}

      {data && data.items.length === 0 && (
        <Text size="sm" c="dimmed">
          No comments.
        </Text>
      )}

      {canCreate && (
        <Card withBorder p="sm">
          <Stack gap="xs">
            <Textarea
              autosize
              minRows={2}
              placeholder="Add a comment..."
              value={body}
              onChange={(e) => setBody(e.currentTarget.value)}
            />
            <Group gap="xs">
              <Select
                size="xs"
                w={120}
                value={type}
                onChange={(v) => setType(v ?? "note")}
                data={[
                  { value: "note", label: "Note" },
                  { value: "issue", label: "Issue" },
                  { value: "feedback", label: "Feedback" },
                ]}
              />
              <Button
                size="xs"
                loading={submitting}
                disabled={!body.trim()}
                onClick={() => void handleSubmit()}
              >
                Post
              </Button>
            </Group>
          </Stack>
        </Card>
      )}
    </Stack>
  );
};
