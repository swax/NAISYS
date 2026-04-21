import {
  Badge,
  Container,
  Group,
  Loader,
  Pagination,
  Select,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import type { ReadyToCloseListResponse } from "@naisys/erp-shared";
import { OrderRunPriorityEnum } from "@naisys/erp-shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import { api, apiEndpoints, showErrorNotification } from "../../lib/api";
import { cellLinkStyle } from "../../lib/tableStyles";

const PRIORITY_COLORS: Record<string, string> = {
  low: "gray",
  medium: "blue",
  high: "orange",
  critical: "red",
};

export const DispatchReadyToClose: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const page = Number(searchParams.get("page")) || 1;
  const priority = searchParams.get("priority") || undefined;
  const search = searchParams.get("search") || "";

  const [searchInput, setSearchInput] = useState(search);
  const [debouncedSearch] = useDebouncedValue(searchInput, 300);
  const isFirstRender = useRef(true);

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

  const [data, setData] = useState<ReadyToCloseListResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("pageSize", "20");
      if (priority) params.set("priority", priority);
      if (search) params.set("search", search);

      const result = await api.get<ReadyToCloseListResponse>(
        `${apiEndpoints.dispatchReadyToClose}?${params}`,
      );
      setData(result);
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setLoading(false);
    }
  }, [page, priority, search]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const totalPages = data ? Math.ceil(data.total / data.pageSize) : 0;

  return (
    <Container size="lg" py="xl">
      <Group justify="space-between" mb="lg">
        <Title order={2}>Dispatch</Title>
      </Group>

      <Tabs
        value="ready-to-close"
        onChange={(v) => {
          if (v === "open") navigate("/dispatch");
        }}
        mb="md"
      >
        <Tabs.List>
          <Tabs.Tab value="open">Open Operations</Tabs.Tab>
          <Tabs.Tab value="ready-to-close">Ready to Close</Tabs.Tab>
        </Tabs.List>
      </Tabs>

      <Group mb="md">
        <TextInput
          placeholder="Search order key or description..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.currentTarget.value)}
          style={{ flex: 1 }}
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
                <Table.Th>Order / Run</Table.Th>
                <Table.Th>Description</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th>Priority</Table.Th>
                <Table.Th>Ops</Table.Th>
                <Table.Th>Due</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data.items.map((item) => {
                const runLink = `/orders/${item.orderKey}/runs/${item.runNo}`;
                return (
                  <Table.Tr key={item.id} style={{ cursor: "pointer" }}>
                    <Table.Td style={{ padding: 0 }}>
                      <Link to={runLink} style={cellLinkStyle}>
                        <Group gap="xs" wrap="nowrap">
                          <Text size="sm" ff="monospace">
                            {item.orderKey}
                          </Text>
                          <Badge color="violet" variant="light" size="sm">
                            R{item.revNo}
                          </Badge>
                          <Text size="sm" ff="monospace">
                            #{item.runNo}
                          </Text>
                        </Group>
                      </Link>
                    </Table.Td>
                    <Table.Td style={{ padding: 0 }}>
                      <Link to={runLink} style={cellLinkStyle}>
                        <Text size="sm" lineClamp={1}>
                          {item.description}
                        </Text>
                      </Link>
                    </Table.Td>
                    <Table.Td style={{ padding: 0 }}>
                      <Link to={runLink} style={cellLinkStyle}>
                        <Badge color="blue" variant="light">
                          {item.status}
                        </Badge>
                      </Link>
                    </Table.Td>
                    <Table.Td style={{ padding: 0 }}>
                      <Link to={runLink} style={cellLinkStyle}>
                        <Badge
                          color={PRIORITY_COLORS[item.priority] ?? "gray"}
                          variant="light"
                        >
                          {item.priority}
                        </Badge>
                      </Link>
                    </Table.Td>
                    <Table.Td style={{ padding: 0 }}>
                      <Link to={runLink} style={cellLinkStyle}>
                        <Text size="sm">{item.opCount}</Text>
                      </Link>
                    </Table.Td>
                    <Table.Td style={{ padding: 0 }}>
                      <Link to={runLink} style={cellLinkStyle}>
                        {item.dueAt
                          ? new Date(item.dueAt).toLocaleDateString()
                          : "—"}
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
          No order runs ready to close.
        </Text>
      )}
    </Container>
  );
};
