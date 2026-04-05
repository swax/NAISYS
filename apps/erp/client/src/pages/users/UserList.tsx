import {
  Button,
  Container,
  Group,
  Loader,
  Modal,
  Pagination,
  PasswordInput,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import type { UserListResponse } from "@naisys/erp-shared";
import { IconAlertTriangle } from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";
import {
  Link,
  useNavigate,
  useOutletContext,
  useSearchParams,
} from "react-router";

import type { AppOutletContext } from "../../components/AppLayout";
import { api, apiEndpoints, showErrorNotification } from "../../lib/api";
import { cellLinkStyle } from "../../lib/tableStyles";

export const UserList: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
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

  const [agentOpened, { open: openAgent, close: closeAgent }] = useDisclosure();
  const [availableAgents, setAvailableAgents] = useState<
    { value: string; label: string }[]
  >([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [creatingAgent, setCreatingAgent] = useState(false);
  const [loadingAgents, setLoadingAgents] = useState(false);

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
      void navigate(`/users/${newUsername}`);
      setNewUsername("");
      setNewPassword("");
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setCreating(false);
    }
  };

  const handleOpenAgentModal = async () => {
    openAgent();
    setSelectedAgentId(null);
    setLoadingAgents(true);
    try {
      const agentResponse = await api.get<{
        items: { id: number; uuid: string; name: string; archived?: boolean }[];
      }>("/supervisor/api/agents");

      // Fetch all ERP users to filter out agents that already have users
      let allUsers: UserListResponse["items"] = [];
      let userPage = 1;
      let userResult: UserListResponse;
      do {
        userResult = await api.get<UserListResponse>(
          `${apiEndpoints.users}?page=${userPage}&pageSize=100`,
        );
        allUsers = allUsers.concat(userResult.items);
        userPage++;
      } while (allUsers.length < userResult.total);

      const existingUsernames = new Set(
        allUsers.filter((u) => u.isAgent).map((u) => u.username),
      );
      const filtered = agentResponse.items
        .filter((a) => !a.archived && !existingUsernames.has(a.name))
        .map((a) => ({ value: String(a.id), label: a.name }));
      setAvailableAgents(filtered);
    } catch (err) {
      showErrorNotification(err);
      closeAgent();
    } finally {
      setLoadingAgents(false);
    }
  };

  const handleCreateAgentUser = async () => {
    if (!selectedAgentId) return;
    setCreatingAgent(true);
    try {
      const result = await api.post<{ username: string }>(
        apiEndpoints.usersFromAgent,
        { agentId: Number(selectedAgentId) },
      );
      closeAgent();
      void navigate(`/users/${result.username}`);
    } catch (err) {
      showErrorNotification(err);
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
          {supervisorAuth && (
            <Button variant="outline" onClick={handleOpenAgentModal}>
              Create Agent User
            </Button>
          )}
          <Button onClick={openCreate}>Create User</Button>
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
                <Table.Th>Permissions</Table.Th>
                <Table.Th>Created</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data.items.map((item) => (
                <Table.Tr key={item.id} style={{ cursor: "pointer" }}>
                  <Table.Td style={{ padding: 0 }}>
                    <Link to={`/users/${item.username}`} style={cellLinkStyle}>
                      <Text size="sm" ff="monospace">
                        {item.username}
                      </Text>
                    </Link>
                  </Table.Td>
                  <Table.Td style={{ padding: 0 }}>
                    <Link to={`/users/${item.username}`} style={cellLinkStyle}>
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
                    </Link>
                  </Table.Td>
                  <Table.Td style={{ padding: 0 }}>
                    <Link to={`/users/${item.username}`} style={cellLinkStyle}>
                      {item.permissionCount}
                    </Link>
                  </Table.Td>
                  <Table.Td style={{ padding: 0 }}>
                    <Link to={`/users/${item.username}`} style={cellLinkStyle}>
                      {new Date(item.createdAt).toLocaleDateString()}
                    </Link>
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
