import {
  Button,
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
import type { ItemListResponse } from "@naisys-erp/shared";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import { api, apiEndpoints, showErrorNotification } from "../../lib/api";
import { hasAction } from "../../lib/hateoas";
import { cellLinkStyle } from "../../lib/tableStyles";

export const ItemList: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const page = Number(searchParams.get("page")) || 1;
  const search = searchParams.get("search") || "";

  const [data, setData] = useState<ItemListResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("pageSize", "20");
      if (search) params.set("search", search);

      const result = await api.get<ItemListResponse>(
        `${apiEndpoints.items}?${params}`,
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
        <Title order={2}>Items</Title>
        {data && hasAction(data._actions, "create") && (
          <Button onClick={() => navigate("/items/new")}>Create New</Button>
        )}
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
                <Table.Th>Key</Table.Th>
                <Table.Th>Description</Table.Th>
                <Table.Th>Created</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data.items.map((item) => {
                const itemLink = `/items/${item.key}`;
                return (
                  <Table.Tr key={item.id} style={{ cursor: "pointer" }}>
                    <Table.Td style={{ padding: 0 }}>
                      <Link to={itemLink} style={cellLinkStyle}>
                        <Text size="sm" ff="monospace">
                          {item.key}
                        </Text>
                      </Link>
                    </Table.Td>
                    <Table.Td style={{ padding: 0 }}>
                      <Link to={itemLink} style={cellLinkStyle}>
                        <Text size="sm" lineClamp={1}>
                          {item.description || "—"}
                        </Text>
                      </Link>
                    </Table.Td>
                    <Table.Td style={{ padding: 0 }}>
                      <Link to={itemLink} style={cellLinkStyle}>
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
          No items found.
        </Text>
      )}
    </Container>
  );
};
