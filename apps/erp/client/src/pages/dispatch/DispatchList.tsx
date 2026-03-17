import {
  Badge,
  Checkbox,
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
import type { DispatchListResponse } from "@naisys-erp/shared";
import {
  OperationRunStatus,
  OrderRunPriorityEnum,
} from "@naisys-erp/shared";
import { useDebouncedValue } from "@mantine/hooks";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";

import { api, apiEndpoints, showErrorNotification } from "../../lib/api";

const cellLinkStyle = {
  display: "block",
  color: "inherit",
  textDecoration: "none",
};

const STATUS_COLORS: Record<string, string> = {
  [OperationRunStatus.blocked]: "gray",
  [OperationRunStatus.pending]: "blue",
  [OperationRunStatus.in_progress]: "yellow",
  [OperationRunStatus.completed]: "green",
  [OperationRunStatus.skipped]: "gray",
  [OperationRunStatus.failed]: "red",
};

const PRIORITY_COLORS: Record<string, string> = {
  low: "gray",
  medium: "blue",
  high: "orange",
  critical: "red",
};

const STATUS_OPTIONS = [
  { value: OperationRunStatus.pending, label: "Pending" },
  { value: OperationRunStatus.in_progress, label: "In Progress" },
  { value: OperationRunStatus.blocked, label: "Blocked" },
];

export const DispatchList: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  const page = Number(searchParams.get("page")) || 1;
  const status = searchParams.get("status") || undefined;
  const priority = searchParams.get("priority") || undefined;
  const search = searchParams.get("search") || "";
  const clockedIn = searchParams.get("clockedIn") === "true";

  const [searchInput, setSearchInput] = useState(search);
  const [debouncedSearch] = useDebouncedValue(searchInput, 300);
  const isFirstRender = useRef(true);

  // Sync debounced value to search params
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    setSearchParams((prev) => {
      if (debouncedSearch) prev.set("search", debouncedSearch);
      else prev.delete("search");
      prev.set("page", "1");
      return prev;
    });
  }, [debouncedSearch, setSearchParams]);

  const [data, setData] = useState<DispatchListResponse | null>(null);
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
      if (clockedIn) params.set("clockedIn", "true");

      const result = await api.get<DispatchListResponse>(
        `${apiEndpoints.dispatch}?${params}`,
      );
      setData(result);
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setLoading(false);
    }
  }, [page, status, priority, search, clockedIn]);

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
          value={searchInput}
          onChange={(e) => setSearchInput(e.currentTarget.value)}
          style={{ flex: 1 }}
        />
        <Select
          placeholder="All open"
          data={STATUS_OPTIONS}
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
        <Checkbox
          label="Clocked In"
          checked={clockedIn}
          onChange={(e) => {
            setSearchParams((prev) => {
              if (e.currentTarget.checked) prev.set("clockedIn", "true");
              else prev.delete("clockedIn");
              prev.set("page", "1");
              return prev;
            });
          }}
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
                <Table.Th>Run</Table.Th>
                <Table.Th>Operation</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th>Priority</Table.Th>
                <Table.Th>Assigned To</Table.Th>
                <Table.Th>Due</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data.items.map((item) => {
                const opRunLink = `/orders/${item.orderKey}/runs/${item.runNo}/ops/${item.seqNo}`;
                return (
                  <Table.Tr key={item.id} style={{ cursor: "pointer" }}>
                    <Table.Td>
                      <Group gap="xs" wrap="nowrap">
                        <Link
                          to={`/orders/${item.orderKey}`}
                          style={cellLinkStyle}
                        >
                          <Text size="sm" ff="monospace">
                            {item.orderKey}
                          </Text>
                        </Link>
                        <Badge
                          component={Link}
                          to={`/orders/${item.orderKey}/revs/${item.revNo}`}
                          color="violet"
                          variant="light"
                          size="sm"
                          style={{ cursor: "pointer" }}
                        >
                          REV {item.revNo}
                        </Badge>
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <Link
                        to={`/orders/${item.orderKey}/runs/${item.runNo}`}
                        style={cellLinkStyle}
                      >
                        <Text size="sm" ff="monospace">
                          {item.runNo}
                        </Text>
                      </Link>
                    </Table.Td>
                    <Table.Td>
                      <Link to={opRunLink} style={cellLinkStyle}>
                        <Text size="sm">
                          <Text span ff="monospace">
                            {item.seqNo}
                          </Text>
                          {" \u2014 "}
                          {item.title}
                        </Text>
                      </Link>
                    </Table.Td>
                    <Table.Td>
                      <Link to={opRunLink} style={cellLinkStyle}>
                        <Badge
                          color={STATUS_COLORS[item.status] ?? "gray"}
                          variant="light"
                        >
                          {item.status}
                        </Badge>
                      </Link>
                    </Table.Td>
                    <Table.Td>
                      <Link to={opRunLink} style={cellLinkStyle}>
                        <Badge
                          color={PRIORITY_COLORS[item.priority] ?? "gray"}
                          variant="light"
                        >
                          {item.priority}
                        </Badge>
                      </Link>
                    </Table.Td>
                    <Table.Td>
                      <Link to={opRunLink} style={cellLinkStyle}>
                        {item.assignedTo ?? "\u2014"}
                      </Link>
                    </Table.Td>
                    <Table.Td>
                      <Link to={opRunLink} style={cellLinkStyle}>
                        {item.dueAt
                          ? new Date(item.dueAt).toLocaleDateString()
                          : "\u2014"}
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
          No open operations found.
        </Text>
      )}
    </Container>
  );
};
