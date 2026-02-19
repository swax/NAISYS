import {
  Table,
  TextInput,
  Pagination,
  Group,
  Button,
  Container,
  Title,
  Stack,
  Text,
  Loader,
  Modal,
  PasswordInput,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { getUsers, createUser } from "../../lib/apiUsers";

export const UserList: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const page = Number(searchParams.get("page")) || 1;
  const search = searchParams.get("search") || "";

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [createOpened, { open: openCreate, close: closeCreate }] =
    useDisclosure();
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getUsers({ page, pageSize: 20, search });
      setData(result);
    } catch {
      // error handled silently
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleCreate = async () => {
    setCreating(true);
    setCreateError("");
    try {
      await createUser({ username: newUsername, password: newPassword });
      closeCreate();
      setNewUsername("");
      setNewPassword("");
      fetchData();
    } catch (err) {
      setCreateError(
        err instanceof Error ? err.message : "Failed to create user",
      );
    } finally {
      setCreating(false);
    }
  };

  const totalPages = data ? Math.ceil(data.total / data.pageSize) : 0;

  return (
    <Container size="lg" py="xl">
      <Group justify="space-between" mb="lg">
        <Title order={2}>Users</Title>
        <Button onClick={openCreate}>Create New</Button>
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
                <Table.Th>Created</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data.items.map((item: any) => (
                <Table.Tr
                  key={item.id}
                  style={{ cursor: "pointer" }}
                  onClick={() => navigate(`/users/${item.id}`)}
                >
                  <Table.Td>{item.username}</Table.Td>
                  <Table.Td>{item.isAgent ? "Agent" : "User"}</Table.Td>
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
            required
          />
          <PasswordInput
            label="Password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.currentTarget.value)}
            required
          />
          {createError && (
            <Text c="red" size="sm">
              {createError}
            </Text>
          )}
          <Group justify="flex-end">
            <Button variant="subtle" onClick={closeCreate}>
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              loading={creating}
              disabled={!newUsername || !newPassword}
            >
              Create
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Container>
  );
};
