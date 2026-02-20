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
  Select,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { getUsers, createUser, createAgentUser } from "../../lib/apiUsers";
import { getAgentData } from "../../lib/apiAgents";

export const UserList: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const page = Number(searchParams.get("page")) || 1;
  const search = searchParams.get("search") || "";

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [createOpened, { open: openCreate, close: closeCreate }] =
    useDisclosure();
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  const [agentOpened, { open: openAgent, close: closeAgent }] = useDisclosure();
  const [availableAgents, setAvailableAgents] = useState<
    { value: string; label: string }[]
  >([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [creatingAgent, setCreatingAgent] = useState(false);
  const [agentError, setAgentError] = useState("");
  const [loadingAgents, setLoadingAgents] = useState(false);

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
    void fetchData();
  }, [fetchData]);

  const handleCreate = async () => {
    setCreating(true);
    setCreateError("");
    try {
      await createUser({ username: newUsername, password: newPassword });
      closeCreate();
      setNewUsername("");
      setNewPassword("");
      void fetchData();
    } catch (err) {
      setCreateError(
        err instanceof Error ? err.message : "Failed to create user",
      );
    } finally {
      setCreating(false);
    }
  };

  const handleOpenAgentModal = async () => {
    openAgent();
    setSelectedAgentId(null);
    setAgentError("");
    setLoadingAgents(true);
    try {
      const agentResponse = await getAgentData();
      let allUsers: any[] = [];
      let userPage = 1;
      let userResult;
      do {
        userResult = await getUsers({ page: userPage, pageSize: 100 });
        allUsers = allUsers.concat(userResult.items);
        userPage++;
      } while (allUsers.length < userResult.total);
      const existingUuids = new Set(allUsers.map((u: any) => u.uuid));
      const filtered = agentResponse.items
        .filter((a) => !a.archived && !existingUuids.has(a.uuid))
        .map((a) => ({ value: String(a.id), label: a.name }));
      setAvailableAgents(filtered);
    } catch {
      setAgentError("Failed to load agents");
    } finally {
      setLoadingAgents(false);
    }
  };

  const handleCreateAgentUser = async () => {
    if (!selectedAgentId) return;
    setCreatingAgent(true);
    setAgentError("");
    try {
      await createAgentUser(Number(selectedAgentId));
      closeAgent();
      void fetchData();
    } catch (err) {
      setAgentError(
        err instanceof Error ? err.message : "Failed to create agent user",
      );
    } finally {
      setCreatingAgent(false);
    }
  };

  const totalPages = data ? Math.ceil(data.total / data.pageSize) : 0;

  return (
    <Container size="lg" py="xl">
      <Group justify="space-between" mb="lg">
        <Title order={2}>Users</Title>
        <Group>
          <Button variant="outline" onClick={handleOpenAgentModal}>
            Create Agent User
          </Button>
          <Button onClick={openCreate}>Create New</Button>
        </Group>
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

      <Modal
        opened={agentOpened}
        onClose={closeAgent}
        title="Create Agent User"
      >
        <Stack>
          {loadingAgents ? (
            <Loader size="sm" />
          ) : (
            <Select
              label="Agent"
              placeholder="Select an agent"
              data={availableAgents}
              value={selectedAgentId}
              onChange={setSelectedAgentId}
              searchable
            />
          )}
          {agentError && (
            <Text c="red" size="sm">
              {agentError}
            </Text>
          )}
          <Group justify="flex-end">
            <Button variant="subtle" onClick={closeAgent}>
              Cancel
            </Button>
            <Button
              onClick={handleCreateAgentUser}
              loading={creatingAgent}
              disabled={!selectedAgentId}
            >
              Create
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Container>
  );
};
