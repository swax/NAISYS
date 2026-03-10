import {
  Button,
  Container,
  Group,
  Loader,
  Modal,
  Pagination,
  PasswordInput,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import type { UserListResponse } from "@naisys-erp/shared";
import { IconAlertTriangle } from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useOutletContext, useSearchParams } from "react-router";

import type { AppOutletContext } from "../../components/AppLayout";
import { api, apiEndpoints, showErrorNotification } from "../../lib/api";

export const UserList: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { supervisorAuth } = useOutletContext<AppOutletContext>();

  const page = Number(searchParams.get("page")) || 1;
  const search = searchParams.get("search") || "";

  const [data, setData] = useState<UserListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [createOpened, { open: openCreate, close: closeCreate }] =
    useDisclosure();
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [creating, setCreating] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("pageSize", "20");
      if (search) params.set("search", search);

      const result = await api.get<UserListResponse>(
        `${apiEndpoints.users}?${params}`,
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

  const handleCreate = async () => {
    setCreating(true);
    try {
      await api.post(apiEndpoints.users, {
        username: newUsername,
        password: newPassword,
      });
      closeCreate();
      setNewUsername("");
      setNewPassword("");
      void fetchData();
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setCreating(false);
    }
  };

  const totalPages = data ? Math.ceil(data.total / data.pageSize) : 0;

  return (
    <Container size="lg" py="xl">
      <Group justify="space-between" mb="lg">
        <Title order={2}>Users</Title>
        <Button onClick={openCreate}>Create User</Button>
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
                <Table.Th>Username</Table.Th>
                <Table.Th>Type</Table.Th>
                <Table.Th>Permissions</Table.Th>
                <Table.Th>Created</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data.items.map((item) => (
                <Table.Tr
                  key={item.id}
                  style={{ cursor: "pointer" }}
                  onClick={() => navigate(`/users/${item.username}`)}
                >
                  <Table.Td>
                    <Text size="sm" ff="monospace">
                      {item.username}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Group gap={4} wrap="nowrap">
                      {item.isAgent ? "Agent" : "User"}
                      {item.isAgent && !supervisorAuth && (
                        <Tooltip label="Agent user without supervisor auth — API key and auth will not work">
                          <IconAlertTriangle
                            size={14}
                            color="var(--mantine-color-red-6)"
                          />
                        </Tooltip>
                      )}
                    </Group>
                  </Table.Td>
                  <Table.Td>{item.permissionCount}</Table.Td>
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
          No users found.
        </Text>
      )}

      <Modal opened={createOpened} onClose={closeCreate} title="Create User">
        <Stack>
          <TextInput
            label="Username"
            value={newUsername}
            onChange={(e) => setNewUsername(e.currentTarget.value)}
            data-autofocus
          />
          <PasswordInput
            label="Password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.currentTarget.value)}
          />
          <Group justify="flex-end">
            <Button variant="subtle" onClick={closeCreate}>
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              loading={creating}
              disabled={!newUsername || newPassword.length < 6}
            >
              Create
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Container>
  );
};
