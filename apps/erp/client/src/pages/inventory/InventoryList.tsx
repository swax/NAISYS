import {
  Container,
  Group,
  Loader,
  Pagination,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import type { InventoryListResponse } from "@naisys-erp/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";

import { api, apiEndpoints, showErrorNotification } from "../../lib/api";

const cellLinkStyle = {
  display: "block",
  color: "inherit",
  textDecoration: "none",
};

export const InventoryList: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  const page = Number(searchParams.get("page")) || 1;
  const search = searchParams.get("search") || "";

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

  const [data, setData] = useState<InventoryListResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("pageSize", "20");
      if (search) params.set("search", search);

      const result = await api.get<InventoryListResponse>(
        `${apiEndpoints.inventory}?${params}`,
      );
      setData(result);
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const totalPages = data ? Math.ceil(data.total / data.pageSize) : 0;

  return (
    <Container size="lg" py="xl">
      <Group justify="space-between" mb="lg">
        <Title order={2}>Inventory</Title>
      </Group>

      <Group mb="md">
        <TextInput
          placeholder="Search..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.currentTarget.value)}
          style={{ flex: 1 }}
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
                <Table.Th>Item</Table.Th>
                <Table.Th>Instance</Table.Th>
                <Table.Th>Quantity</Table.Th>
                <Table.Th>Produced By</Table.Th>
                <Table.Th>Created</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data.items.map((item) => {
                const instanceLink = `/items/${item.itemKey}/instances/${item.id}`;
                return (
                  <Table.Tr key={item.id} style={{ cursor: "pointer" }}>
                    <Table.Td>
                      <Link
                        to={`/items/${item.itemKey}`}
                        style={cellLinkStyle}
                      >
                        <Text size="sm" ff="monospace">
                          {item.itemKey}
                        </Text>
                      </Link>
                    </Table.Td>
                    <Table.Td>
                      <Link to={instanceLink} style={cellLinkStyle}>
                        <Text size="sm" ff="monospace">
                          {item.key}
                        </Text>
                      </Link>
                    </Table.Td>
                    <Table.Td>
                      <Link to={instanceLink} style={cellLinkStyle}>
                        {item.quantity != null ? item.quantity : "\u2014"}
                      </Link>
                    </Table.Td>
                    <Table.Td>
                      <Link to={instanceLink} style={cellLinkStyle}>
                        {item.orderKey ? (
                          <Text size="sm">
                            {item.orderKey} Run {item.orderRunNo}
                          </Text>
                        ) : (
                          "\u2014"
                        )}
                      </Link>
                    </Table.Td>
                    <Table.Td>
                      <Link to={instanceLink} style={cellLinkStyle}>
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
          No inventory found.
        </Text>
      )}
    </Container>
  );
};
