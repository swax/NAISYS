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
import { useForm } from "@mantine/form";
import type {
  OrderRevision,
  OrderRevisionListResponse,
} from "@naisys-erp/shared";
import { CreateOrderRevisionSchema } from "@naisys-erp/shared";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";

import { api, showErrorNotification } from "../lib/api";
import { hasAction } from "../lib/hateoas";
import { zodResolver } from "../lib/zod-resolver";

const STATUS_COLORS: Record<string, string> = {
  draft: "blue",
  approved: "green",
  obsolete: "gray",
};

const PAGE_SIZE = 10;

interface Props {
  orderKey: string;
}

export const OrderRevisions: React.FC<Props> = ({ orderKey }) => {
  const navigate = useNavigate();
  const [data, setData] = useState<OrderRevisionListResponse | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const form = useForm({
    initialValues: {
      notes: "",
      changeSummary: "",
    },
    validate: zodResolver(CreateOrderRevisionSchema),
  });

  const basePath = `orders/${orderKey}/revs`;

  const fetchRevisions = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get<OrderRevisionListResponse>(
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
    void fetchRevisions();
  }, [fetchRevisions]);

  const handleCreate = async (values: typeof form.values) => {
    setSubmitting(true);
    try {
      const created = await api.post<OrderRevision>(basePath, {
        notes: values.notes || undefined,
        changeSummary: values.changeSummary || undefined,
      });
      setModalOpen(false);
      form.reset();
      void navigate(`/orders/${orderKey}/revs/${created.revNo}`);
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCloseModal = () => {
    setModalOpen(false);
    form.reset();
  };

  const handleApprove = async (rev: OrderRevision) => {
    if (!confirm(`Approve revision #${rev.revNo}?`)) return;
    try {
      await api.post(`${basePath}/${rev.revNo}/approve`, {});
      await fetchRevisions();
    } catch (err) {
      showErrorNotification(err);
    }
  };

  const handleObsolete = async (rev: OrderRevision) => {
    if (!confirm(`Mark revision #${rev.revNo} as obsolete?`)) return;
    try {
      await api.post(`${basePath}/${rev.revNo}/obsolete`, {});
      await fetchRevisions();
    } catch (err) {
      showErrorNotification(err);
    }
  };

  const handleDelete = async (rev: OrderRevision) => {
    if (!confirm(`Delete revision #${rev.revNo}?`)) return;
    try {
      await api.delete(`${basePath}/${rev.revNo}`);
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
                <Table.Th>Actions</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data.items.map((rev) => (
                <Table.Tr
                  key={rev.id}
                  style={{ cursor: "pointer" }}
                  onClick={() =>
                    navigate(
                      `/orders/${orderKey}/revs/${rev.revNo}`,
                    )
                  }
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
                  <Table.Td onClick={(e) => e.stopPropagation()}>
                    <Group gap="xs">
                      {hasAction(rev._actions, "approve") && (
                        <Button
                          size="xs"
                          variant="light"
                          color="green"
                          onClick={() => handleApprove(rev)}
                          data-testid={`revision-approve-${rev.revNo}`}
                        >
                          Approve
                        </Button>
                      )}
                      {hasAction(rev._actions, "delete") && (
                        <Button
                          size="xs"
                          variant="light"
                          color="red"
                          onClick={() => handleDelete(rev)}
                        >
                          Delete
                        </Button>
                      )}
                      {hasAction(rev._actions, "cut-order") && (
                        <Button
                          size="xs"
                          variant="light"
                          color="teal"
                          onClick={() =>
                            navigate(
                              `/orders/${orderKey}/runs/new?revNo=${rev.revNo}`,
                            )
                          }
                          data-testid={`revision-cut-order-${rev.revNo}`}
                        >
                          Cut Order
                        </Button>
                      )}
                      {hasAction(rev._actions, "obsolete") && (
                        <Button
                          size="xs"
                          variant="light"
                          color="gray"
                          onClick={() => handleObsolete(rev)}
                        >
                          Mark Obsolete
                        </Button>
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

      <Modal opened={modalOpen} onClose={handleCloseModal} title="New Revision">
        <form onSubmit={form.onSubmit(handleCreate)}>
          <Stack gap="md">
            <Textarea
              label="Notes"
              placeholder="Optional notes for this revision..."
              {...form.getInputProps("notes")}
              minRows={2}
            />
            <Textarea
              label="Change Summary"
              placeholder="What changed in this revision..."
              {...form.getInputProps("changeSummary")}
              minRows={2}
            />
            <Group justify="flex-end">
              <Button variant="subtle" onClick={handleCloseModal}>
                Cancel
              </Button>
              <Button type="submit" loading={submitting}>
                Create
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </Card>
  );
};
