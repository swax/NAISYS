import {
  Button,
  Card,
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
import { hasAction } from "@naisys/common";
import type {
  CreateItemInstance,
  ItemInstanceListResponse,
} from "@naisys/erp-shared";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";

import { api, apiEndpoints, showErrorNotification } from "../../lib/api";
import { cellLinkStyle } from "../../lib/tableStyles";

export const ItemInstanceList: React.FC = () => {
  const { key } = useParams<{ key: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const page = Number(searchParams.get("page")) || 1;
  const search = searchParams.get("search") || "";

  const [data, setData] = useState<ItemInstanceListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newQuantity, setNewQuantity] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fetchData = useCallback(async () => {
    if (!key) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("pageSize", "20");
      if (search) params.set("search", search);

      const result = await api.get<ItemInstanceListResponse>(
        `${apiEndpoints.itemInstances(key)}?${params}`,
      );
      setData(result);
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setLoading(false);
    }
  }, [key, page, search]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const handleCreate = async () => {
    if (!key) return;
    setSubmitting(true);
    try {
      const body: CreateItemInstance = {
        key: newKey,
        quantity: newQuantity ? Number(newQuantity) : null,
      };
      const result = await api.post<{ id: number }>(
        apiEndpoints.itemInstances(key),
        body,
      );
      void navigate(`/items/${key}/instances/${result.id}`);
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setSubmitting(false);
    }
  };

  const totalPages = data ? Math.ceil(data.total / data.pageSize) : 0;

  return (
    <Container size="lg" py="xl">
      <Group justify="space-between" mb="lg">
        <Group>
          <Title order={2}>Instances for {key}</Title>
        </Group>
        <Group>
          <Button variant="subtle" onClick={() => navigate(`/items/${key}`)}>
            Back to Item
          </Button>
          {data && hasAction(data._actions, "create") && !creating && (
            <Button onClick={() => setCreating(true)}>Create New</Button>
          )}
        </Group>
      </Group>

      {creating && (
        <Card withBorder p="lg" mb="md">
          <Title order={4} mb="sm">
            New Instance
          </Title>
          <Stack>
            <TextInput
              label="Key (lot/serial number)"
              value={newKey}
              onChange={(e) => setNewKey(e.currentTarget.value)}
              required
              data-autofocus
            />
            <TextInput
              label="Quantity"
              type="number"
              value={newQuantity}
              onChange={(e) => setNewQuantity(e.currentTarget.value)}
            />
            <Group justify="flex-end">
              <Button
                variant="subtle"
                onClick={() => {
                  setCreating(false);
                  setNewKey("");
                  setNewQuantity("");
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreate}
                loading={submitting}
                disabled={!newKey}
              >
                Create
              </Button>
            </Group>
          </Stack>
        </Card>
      )}

      <Group mb="md">
        <TextInput
          placeholder="Search by key..."
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
                <Table.Th>Quantity</Table.Th>
                <Table.Th>Order Run</Table.Th>
                <Table.Th>Created</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data.items.map((inst) => {
                const instLink = `/items/${key}/instances/${inst.id}`;
                return (
                  <Table.Tr key={inst.id} style={{ cursor: "pointer" }}>
                    <Table.Td style={{ padding: 0 }}>
                      <Link to={instLink} style={cellLinkStyle}>
                        <Text size="sm" ff="monospace">
                          {inst.key}
                        </Text>
                      </Link>
                    </Table.Td>
                    <Table.Td style={{ padding: 0 }}>
                      <Link to={instLink} style={cellLinkStyle}>
                        <Text size="sm">
                          {inst.quantity != null ? inst.quantity : "—"}
                        </Text>
                      </Link>
                    </Table.Td>
                    <Table.Td style={{ padding: 0 }}>
                      <Link to={instLink} style={cellLinkStyle}>
                        <Text size="sm">
                          {inst.orderKey
                            ? `${inst.orderKey} Run ${inst.orderRunNo}`
                            : "—"}
                        </Text>
                      </Link>
                    </Table.Td>
                    <Table.Td style={{ padding: 0 }}>
                      <Link to={instLink} style={cellLinkStyle}>
                        {new Date(inst.createdAt).toLocaleDateString()}
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
          No instances found.
        </Text>
      )}
    </Container>
  );
};
