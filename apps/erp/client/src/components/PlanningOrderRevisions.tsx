import {
  Badge,
  Button,
  Card,
  Group,
  Loader,
  Modal,
  Pagination,
  Stack,
  Table,
  Text,
  Textarea,
  Title,
} from "@mantine/core";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import type {
  PlanningOrderRevision,
  PlanningOrderRevisionListResponse,
} from "shared";
import { api, showErrorNotification } from "../lib/api";

const STATUS_COLORS: Record<string, string> = {
  draft: "blue",
  approved: "green",
  obsolete: "gray",
};

const PAGE_SIZE = 10;

interface Props {
  orderId: string;
}

export const PlanningOrderRevisions: React.FC<Props> = ({ orderId }) => {
  const navigate = useNavigate();
  const [data, setData] = useState<PlanningOrderRevisionListResponse | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [changeSummary, setChangeSummary] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const basePath = `planning/orders/${orderId}/revisions`;

  const fetchRevisions = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get<PlanningOrderRevisionListResponse>(
        `${basePath}?page=${page}&pageSize=${PAGE_SIZE}`,
      );
      setData(result);
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setLoading(false);
    }
  }, [basePath, page]);

  useEffect(() => {
    fetchRevisions();
  }, [fetchRevisions]);

  const handleCreate = async () => {
    setSubmitting(true);
    try {
      await api.post(basePath, {
        notes: notes || undefined,
        changeSummary: changeSummary || undefined,
      });
      setModalOpen(false);
      setNotes("");
      setChangeSummary("");
      await fetchRevisions();
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleApprove = async (rev: PlanningOrderRevision) => {
    if (!confirm(`Approve revision #${rev.revNo}?`)) return;
    try {
      await api.post(`${basePath}/${rev.id}/approve`, {});
      await fetchRevisions();
    } catch (err) {
      showErrorNotification(err);
    }
  };

  const handleObsolete = async (rev: PlanningOrderRevision) => {
    if (!confirm(`Mark revision #${rev.revNo} as obsolete?`)) return;
    try {
      await api.post(`${basePath}/${rev.id}/obsolete`, {});
      await fetchRevisions();
    } catch (err) {
      showErrorNotification(err);
    }
  };

  const handleDelete = async (rev: PlanningOrderRevision) => {
    if (!confirm(`Delete revision #${rev.revNo}?`)) return;
    try {
      await api.delete(`${basePath}/${rev.id}`);
      await fetchRevisions();
    } catch (err) {
      showErrorNotification(err);
    }
  };

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;

  return (
    <Card withBorder p="lg" mt="lg">
      <Group justify="space-between" mb="md">
        <Title order={4}>Revisions</Title>
        <Button size="sm" onClick={() => setModalOpen(true)}>
          New Revision
        </Button>
      </Group>

      {loading ? (
        <Stack align="center" py="md">
          <Loader />
        </Stack>
      ) : !data || data.items.length === 0 ? (
        <Text c="dimmed">No revisions yet.</Text>
      ) : (
        <>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Rev #</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th>Notes</Table.Th>
                <Table.Th>Change Summary</Table.Th>
                <Table.Th>Created</Table.Th>
                <Table.Th>Approved</Table.Th>
                <Table.Th>Actions</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data.items.map((rev) => (
                <Table.Tr
                  key={rev.id}
                  data-testid={`revision-row-${rev.revNo}`}
                >
                  <Table.Td>{rev.revNo}</Table.Td>
                  <Table.Td>
                    <Badge
                      color={STATUS_COLORS[rev.status] ?? "gray"}
                      variant="light"
                      data-testid={`revision-status-${rev.revNo}`}
                    >
                      {rev.status}
                    </Badge>
                  </Table.Td>
                  <Table.Td>{rev.notes ?? "—"}</Table.Td>
                  <Table.Td>{rev.changeSummary ?? "—"}</Table.Td>
                  <Table.Td>
                    {new Date(rev.createdAt).toLocaleString()}
                  </Table.Td>
                  <Table.Td>
                    {rev.approvedAt
                      ? new Date(rev.approvedAt).toLocaleString()
                      : "—"}
                  </Table.Td>
                  <Table.Td>
                    <Group gap="xs">
                      {rev.status === "draft" && (
                        <>
                          <Button
                            size="xs"
                            variant="light"
                            color="green"
                            onClick={() => handleApprove(rev)}
                            data-testid={`revision-approve-${rev.revNo}`}
                          >
                            Approve
                          </Button>
                          <Button
                            size="xs"
                            variant="light"
                            color="red"
                            onClick={() => handleDelete(rev)}
                          >
                            Delete
                          </Button>
                        </>
                      )}
                      {rev.status === "approved" && (
                        <>
                          <Button
                            size="xs"
                            variant="light"
                            color="teal"
                            onClick={() =>
                              navigate(
                                `/execution/orders/new?planOrderId=${orderId}&planOrderRevId=${rev.id}`,
                              )
                            }
                            data-testid={`revision-cut-order-${rev.revNo}`}
                          >
                            Cut Order
                          </Button>
                          <Button
                            size="xs"
                            variant="light"
                            color="gray"
                            onClick={() => handleObsolete(rev)}
                          >
                            Mark Obsolete
                          </Button>
                        </>
                      )}
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>

          {totalPages > 1 && (
            <Group justify="center" mt="md">
              <Pagination total={totalPages} value={page} onChange={setPage} />
            </Group>
          )}
        </>
      )}

      <Modal
        opened={modalOpen}
        onClose={() => setModalOpen(false)}
        title="New Revision"
      >
        <Stack gap="md">
          <Textarea
            label="Notes"
            placeholder="Optional notes for this revision..."
            value={notes}
            onChange={(e) => setNotes(e.currentTarget.value)}
            minRows={2}
          />
          <Textarea
            label="Change Summary"
            placeholder="What changed in this revision..."
            value={changeSummary}
            onChange={(e) => setChangeSummary(e.currentTarget.value)}
            minRows={2}
          />
          <Group justify="flex-end">
            <Button variant="subtle" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} loading={submitting}>
              Create
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Card>
  );
};
