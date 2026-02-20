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
import type { PlanningOrderListResponse } from "@naisys-erp/shared";
import { api, showErrorNotification } from "../lib/api";

export const PlanningOrderList: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const page = Number(searchParams.get("page")) || 1;
  const status = searchParams.get("status") || undefined;
  const search = searchParams.get("search") || "";

  const [data, setData] = useState<PlanningOrderListResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("pageSize", "20");
      if (status) params.set("status", status);
      if (search) params.set("search", search);

      const result = await api.get<PlanningOrderListResponse>(
        `planning/orders?${params}`,
      );
      setData(result);
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setLoading(false);
    }
  }, [page, status, search]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const totalPages = data ? Math.ceil(data.total / data.pageSize) : 0;

  return (
    <Container size="lg" py="xl">
      <Group justify="space-between" mb="lg">
        <Title order={2}>Planning Orders</Title>
        <Button onClick={() => navigate("/planning/orders/new")}>
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
            { value: "active", label: "Active" },
            { value: "archived", label: "Archived" },
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
                <Table.Th>Name</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th>Created</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data.items.map((item) => (
                <Table.Tr
                  key={item.id}
                  style={{ cursor: "pointer" }}
                  onClick={() => navigate(`/planning/orders/${item.id}`)}
                >
                  <Table.Td>
                    <Text size="sm" ff="monospace">
                      {item.key}
                    </Text>
                  </Table.Td>
                  <Table.Td>{item.name}</Table.Td>
                  <Table.Td>
                    <Badge
                      color={item.status === "active" ? "green" : "gray"}
                      variant="light"
                    >
                      {item.status}
                    </Badge>
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
          No planning orders found.
        </Text>
      )}
    </Container>
  );
};
