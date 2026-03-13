import {
  Badge,
  Container,
  Group,
  Loader,
  Pagination,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import type { OrderRunListResponse } from "@naisys-erp/shared";
import {
  OrderRunPriority,
  OrderRunPriorityEnum,
  OrderRunStatus,
} from "@naisys-erp/shared";
import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";

import { api, apiEndpoints, showErrorNotification } from "../../lib/api";

const cellLinkStyle = {
  display: "block",
  color: "inherit",
  textDecoration: "none",
};

const STATUS_COLORS: Record<string, string> = {
  [OrderRunStatus.released]: "blue",
  [OrderRunStatus.started]: "yellow",
  [OrderRunStatus.closed]: "green",
  [OrderRunStatus.cancelled]: "gray",
};

const PRIORITY_COLORS: Record<string, string> = {
  [OrderRunPriority.low]: "gray",
  [OrderRunPriority.medium]: "blue",
  [OrderRunPriority.high]: "orange",
  [OrderRunPriority.critical]: "red",
};

const OPEN_STATUSES = [
  { value: OrderRunStatus.released, label: "Released" },
  { value: OrderRunStatus.started, label: "Started" },
];

export const DispatchList: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  const page = Number(searchParams.get("page")) || 1;
  const status = searchParams.get("status") || undefined;
  const priority = searchParams.get("priority") || undefined;
  const search = searchParams.get("search") || "";

  const [data, setData] = useState<OrderRunListResponse | null>(null);
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

      const result = await api.get<OrderRunListResponse>(
        `${apiEndpoints.dispatch}?${params}`,
      );
      setData(result);
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setLoading(false);
    }
  }, [page, status, priority, search]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const totalPages = data ? Math.ceil(data.total / data.pageSize) : 0;

  return (
    <Container size="lg" py="xl">
      <Group justify="space-between" mb="lg">
        <Title order={2}>Dispatch</Title>
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
          placeholder="All open"
          data={OPEN_STATUSES}
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
          data={OrderRunPriorityEnum.options.map((v) => ({
            value: v,
            label: v.charAt(0).toUpperCase() + v.slice(1),
          }))}
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
                <Table.Th>Order</Table.Th>
                <Table.Th>Run #</Table.Th>
                <Table.Th>Rev</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th>Priority</Table.Th>
                <Table.Th>Assigned To</Table.Th>
                <Table.Th>Due</Table.Th>
                <Table.Th>Created</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data.items.map((item) => {
                const runLink = `/orders/${item.orderKey}/runs/${item.id}`;
                return (
                  <Table.Tr key={item.id} style={{ cursor: "pointer" }}>
                    <Table.Td>
                      <Link
                        to={`/orders/${item.orderKey}`}
                        style={cellLinkStyle}
                      >
                        <Text size="sm" ff="monospace">
                          {item.orderKey}
                        </Text>
                      </Link>
                    </Table.Td>
                    <Table.Td>
                      <Link to={runLink} style={cellLinkStyle}>
                        <Text size="sm" ff="monospace">
                          {item.runNo}
                        </Text>
                      </Link>
                    </Table.Td>
                    <Table.Td>
                      <Link to={runLink} style={cellLinkStyle}>
                        {item.revNo}
                      </Link>
                    </Table.Td>
                    <Table.Td>
                      <Link to={runLink} style={cellLinkStyle}>
                        <Badge
                          color={STATUS_COLORS[item.status] ?? "gray"}
                          variant="light"
                        >
                          {item.status}
                        </Badge>
                      </Link>
                    </Table.Td>
                    <Table.Td>
                      <Link to={runLink} style={cellLinkStyle}>
                        <Badge
                          color={PRIORITY_COLORS[item.priority] ?? "gray"}
                          variant="light"
                        >
                          {item.priority}
                        </Badge>
                      </Link>
                    </Table.Td>
                    <Table.Td>
                      <Link to={runLink} style={cellLinkStyle}>
                        {item.assignedTo ?? "\u2014"}
                      </Link>
                    </Table.Td>
                    <Table.Td>
                      <Link to={runLink} style={cellLinkStyle}>
                        {item.dueAt
                          ? new Date(item.dueAt).toLocaleDateString()
                          : "\u2014"}
                      </Link>
                    </Table.Td>
                    <Table.Td>
                      <Link to={runLink} style={cellLinkStyle}>
                        {new Date(item.createdAt).toLocaleDateString()}
                      </Link>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
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
          No open order runs found.
        </Text>
      )}
    </Container>
  );
};
