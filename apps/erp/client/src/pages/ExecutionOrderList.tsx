import {
  Table,
  TextInput,
  Select,
  Pagination,
  Group,
  Button,
  Badge,
  Container,
  Title,
  Stack,
  Text,
  Loader,
} from "@mantine/core";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import type { ExecutionOrderListResponse } from "shared";
import { api, showErrorNotification } from "../lib/api";

const STATUS_COLORS: Record<string, string> = {
  released: "blue",
  started: "yellow",
  closed: "green",
  cancelled: "gray",
};

const PRIORITY_COLORS: Record<string, string> = {
  low: "gray",
  medium: "blue",
  high: "orange",
  critical: "red",
};

export const ExecutionOrderList: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const page = Number(searchParams.get("page")) || 1;
  const status = searchParams.get("status") || undefined;
  const priority = searchParams.get("priority") || undefined;
  const search = searchParams.get("search") || "";

  const [data, setData] = useState<ExecutionOrderListResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("pageSize", "20");
      if (status) params.set("status", status);
      if (priority) params.set("priority", priority);
      if (search) params.set("search", search);

      const result = await api.get<ExecutionOrderListResponse>(
        `execution/orders?${params}`,
      );
      setData(result);
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setLoading(false);
    }
  }, [page, status, priority, search]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const totalPages = data ? Math.ceil(data.total / data.pageSize) : 0;

  return (
    <Container size="lg" py="xl">
      <Group justify="space-between" mb="lg">
        <Title order={2}>Execution Orders</Title>
        <Button onClick={() => navigate("/execution/orders/new")}>
          Create New
        </Button>
      </Group>

      <Group mb="md">
        <TextInput
          placeholder="Search..."
          value={search}
          onChange={(e) => {
            const val = e.currentTarget.value;
            setSearchParams((prev) => {
              if (val) prev.set("search", val);
              else prev.delete("search");
              prev.set("page", "1");
              return prev;
            });
          }}
          style={{ flex: 1 }}
        />
        <Select
          placeholder="All statuses"
          data={[
            { value: "released", label: "Released" },
            { value: "started", label: "Started" },
            { value: "closed", label: "Closed" },
            { value: "cancelled", label: "Cancelled" },
          ]}
          value={status ?? null}
          onChange={(val) => {
            setSearchParams((prev) => {
              if (val) prev.set("status", val);
              else prev.delete("status");
              prev.set("page", "1");
              return prev;
            });
          }}
          clearable
        />
        <Select
          placeholder="All priorities"
          data={[
            { value: "low", label: "Low" },
            { value: "medium", label: "Medium" },
            { value: "high", label: "High" },
            { value: "critical", label: "Critical" },
          ]}
          value={priority ?? null}
          onChange={(val) => {
            setSearchParams((prev) => {
              if (val) prev.set("priority", val);
              else prev.delete("priority");
              prev.set("page", "1");
              return prev;
            });
          }}
          clearable
        />
      </Group>

      {loading ? (
        <Stack align="center" py="xl">
          <Loader />
        </Stack>
      ) : data && data.items.length > 0 ? (
        <>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Order #</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th>Priority</Table.Th>
                <Table.Th>Assigned To</Table.Th>
                <Table.Th>Due</Table.Th>
                <Table.Th>Created</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data.items.map((item) => (
                <Table.Tr
                  key={item.id}
                  style={{ cursor: "pointer" }}
                  onClick={() => navigate(`/execution/orders/${item.id}`)}
                  data-testid={`exec-order-row-${item.orderNo}`}
                >
                  <Table.Td>
                    <Text size="sm" ff="monospace">
                      {item.orderNo}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge
                      color={STATUS_COLORS[item.status] ?? "gray"}
                      variant="light"
                    >
                      {item.status}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Badge
                      color={PRIORITY_COLORS[item.priority] ?? "gray"}
                      variant="light"
                    >
                      {item.priority}
                    </Badge>
                  </Table.Td>
                  <Table.Td>{item.assignedTo ?? "—"}</Table.Td>
                  <Table.Td>
                    {item.dueAt
                      ? new Date(item.dueAt).toLocaleDateString()
                      : "—"}
                  </Table.Td>
                  <Table.Td>
                    {new Date(item.createdAt).toLocaleDateString()}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          {totalPages > 1 && (
            <Group justify="center" mt="md">
              <Pagination
                total={totalPages}
                value={page}
                onChange={(p) =>
                  setSearchParams((prev) => {
                    prev.set("page", String(p));
                    return prev;
                  })
                }
              />
            </Group>
          )}
        </>
      ) : (
        <Text c="dimmed" ta="center" py="xl">
          No execution orders found.
        </Text>
      )}
    </Container>
  );
};
