import {
  Badge,
  Button,
  Card,
  Group,
  Loader,
  Pagination,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import type {
  OrderRevision,
  OrderRevisionListResponse,
} from "@naisys-erp/shared";
import { RevisionStatus } from "@naisys-erp/shared";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";

import { api, apiEndpoints, showErrorNotification } from "../lib/api";
import { hasAction } from "../lib/hateoas";

const cellLinkStyle = {
  display: "block",
  color: "inherit",
  textDecoration: "none",
};

const STATUS_COLORS: Record<string, string> = {
  [RevisionStatus.draft]: "blue",
  [RevisionStatus.approved]: "green",
  [RevisionStatus.obsolete]: "gray",
};

const PAGE_SIZE = 10;

interface Props {
  orderKey: string;
}

export const OrderRevisions: React.FC<Props> = ({ orderKey }) => {
  const navigate = useNavigate();
  const [data, setData] = useState<OrderRevisionListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);

  const fetchRevisions = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get<OrderRevisionListResponse>(
        `${apiEndpoints.orderRevs(orderKey)}?page=${page}&pageSize=${PAGE_SIZE}`,
      );
      setData(result);
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setLoading(false);
    }
  }, [orderKey, page]);

  useEffect(() => {
    void fetchRevisions();
  }, [fetchRevisions]);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const created = await api.post<OrderRevision>(
        apiEndpoints.orderRevs(orderKey),
        {},
      );
      void navigate(`/orders/${orderKey}/revs/${created.revNo}/header`);
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setCreating(false);
    }
  };

  const handleApprove = async (rev: OrderRevision) => {
    if (!confirm(`Approve revision #${rev.revNo}?`)) return;
    try {
      await api.post(apiEndpoints.orderRevApprove(orderKey, rev.revNo), {});
      await fetchRevisions();
    } catch (err) {
      showErrorNotification(err);
    }
  };

  const handleObsolete = async (rev: OrderRevision) => {
    if (!confirm(`Mark revision #${rev.revNo} as obsolete?`)) return;
    try {
      await api.post(apiEndpoints.orderRevObsolete(orderKey, rev.revNo), {});
      await fetchRevisions();
    } catch (err) {
      showErrorNotification(err);
    }
  };

  const handleDelete = async (rev: OrderRevision) => {
    if (!confirm(`Delete revision #${rev.revNo}?`)) return;
    try {
      await api.delete(apiEndpoints.orderRev(orderKey, rev.revNo));
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
        {data && hasAction(data._actions, "create") && (
          <Button size="sm" onClick={handleCreate} loading={creating}>
            New Revision
          </Button>
        )}
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
                <Table.Th>Change Summary</Table.Th>
                <Table.Th>Created</Table.Th>
                <Table.Th>Actions</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data.items.map((rev) => {
                const revLink = `/orders/${orderKey}/revs/${rev.revNo}`;
                return (
                  <Table.Tr
                    key={rev.id}
                    style={{ cursor: "pointer" }}
                    data-testid={`revision-row-${rev.revNo}`}
                  >
                    <Table.Td>
                      <Link to={revLink} style={cellLinkStyle}>
                        {rev.revNo}
                      </Link>
                    </Table.Td>
                    <Table.Td>
                      <Link to={revLink} style={cellLinkStyle}>
                        <Badge
                          color={STATUS_COLORS[rev.status] ?? "gray"}
                          variant="light"
                          data-testid={`revision-status-${rev.revNo}`}
                        >
                          {rev.status}
                        </Badge>
                      </Link>
                    </Table.Td>
                    <Table.Td>
                      <Link to={revLink} style={cellLinkStyle}>
                        {rev.changeSummary ?? "—"}
                      </Link>
                    </Table.Td>
                    <Table.Td>
                      <Link to={revLink} style={cellLinkStyle}>
                        {new Date(rev.createdAt).toLocaleString()}
                      </Link>
                    </Table.Td>
                    <Table.Td>
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
                            component={Link}
                            to={`/orders/${orderKey}/runs/new?revNo=${rev.revNo}`}
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
                );
              })}
            </Table.Tbody>
          </Table>

          {totalPages > 1 && (
            <Group justify="center" mt="md">
              <Pagination total={totalPages} value={page} onChange={setPage} />
            </Group>
          )}
        </>
      )}

    </Card>
  );
};
