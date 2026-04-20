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
import { hasAction } from "@naisys/common";
import type { WorkCenterListResponse } from "@naisys/erp-shared";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import { api, apiEndpoints, showErrorNotification } from "../../lib/api";
import { cellLinkStyle } from "../../lib/tableStyles";

export const WorkCenterList: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const page = Number(searchParams.get("page")) || 1;
  const search = searchParams.get("search") || "";

  const [data, setData] = useState<WorkCenterListResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("pageSize", "20");
      if (search) params.set("search", search);

      const result = await api.get<WorkCenterListResponse>(
        `${apiEndpoints.workCenters}?${params}`,
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
        <Title order={2}>Work Centers</Title>
        {data && hasAction(data._actions, "create") && (
          <Button onClick={() => navigate("/work-centers/new")}>
            Create New
          </Button>
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
                <Table.Th>Users</Table.Th>
                <Table.Th>Created</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data.items.map((wc) => {
                const wcLink = `/work-centers/${wc.key}`;
                return (
                  <Table.Tr key={wc.id} style={{ cursor: "pointer" }}>
                    <Table.Td style={{ padding: 0 }}>
                      <Link to={wcLink} style={cellLinkStyle}>
                        <Text size="sm" ff="monospace">
                          {wc.key}
                        </Text>
                      </Link>
                    </Table.Td>
                    <Table.Td style={{ padding: 0 }}>
                      <Link to={wcLink} style={cellLinkStyle}>
                        <Text size="sm" lineClamp={1}>
                          {wc.description || "\u2014"}
                        </Text>
                      </Link>
                    </Table.Td>
                    <Table.Td style={{ padding: 0 }}>
                      <Link to={wcLink} style={cellLinkStyle}>
                        <Text size="sm">{wc.userCount}</Text>
                      </Link>
                    </Table.Td>
                    <Table.Td style={{ padding: 0 }}>
                      <Link to={wcLink} style={cellLinkStyle}>
                        {new Date(wc.createdAt).toLocaleDateString()}
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
          No work centers found.
        </Text>
      )}
    </Container>
  );
};
