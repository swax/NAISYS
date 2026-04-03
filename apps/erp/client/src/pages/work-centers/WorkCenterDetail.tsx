import {
  ActionIcon,
  Button,
  Card,
  Container,
  Group,
  Loader,
  Stack,
  Table,
  Text,
  Textarea,
  TextInput,
  Title,
} from "@mantine/core";
import type { UpdateWorkCenter, WorkCenter } from "@naisys/erp-shared";
import { IconTrash } from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";

import { MetadataTooltip } from "../../components/MetadataTooltip";
import { UserAutocomplete } from "../../components/UserAutocomplete";
import { api, apiEndpoints, showErrorNotification } from "../../lib/api";
import { hasAction } from "../../lib/hateoas";

export const WorkCenterDetail: React.FC = () => {
  const { key } = useParams<{ key: string }>();
  const navigate = useNavigate();
  const [wc, setWc] = useState<WorkCenter | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editKey, setEditKey] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [newUsername, setNewUsername] = useState("");

  const fetchWc = useCallback(async () => {
    if (!key) return;
    setLoading(true);
    try {
      const result = await api.get<WorkCenter>(apiEndpoints.workCenter(key));
      setWc(result);
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setLoading(false);
    }
  }, [key]);

  useEffect(() => {
    void fetchWc();
  }, [fetchWc]);

  const handleEdit = () => {
    if (!wc) return;
    setEditKey(wc.key);
    setDescription(wc.description);
    setEditing(true);
  };

  const handleUpdate = async () => {
    if (!key) return;
    setSubmitting(true);
    try {
      const data: UpdateWorkCenter = { key: editKey, description };
      await api.put(apiEndpoints.workCenter(key), data);
      setEditing(false);
      if (editKey !== key) {
        void navigate(`/work-centers/${editKey}`, { replace: true });
      } else {
        await fetchWc();
      }
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!key || !confirm("Delete this work center?")) return;
    try {
      await api.delete(apiEndpoints.workCenter(key));
      void navigate("/work-centers");
    } catch (err) {
      showErrorNotification(err);
    }
  };

  const handleAssignUser = async () => {
    if (!key || !newUsername.trim()) return;
    try {
      await api.post(apiEndpoints.workCenterUsers(key), {
        username: newUsername.trim(),
      });
      setNewUsername("");
      await fetchWc();
    } catch (err) {
      showErrorNotification(err);
    }
  };

  const handleRemoveUser = async (username: string) => {
    if (!key) return;
    try {
      await api.delete(apiEndpoints.workCenterUser(key, username));
      await fetchWc();
    } catch (err) {
      showErrorNotification(err);
    }
  };

  if (loading) {
    return (
      <Container size="md" py="xl">
        <Stack align="center">
          <Loader />
        </Stack>
      </Container>
    );
  }

  if (!wc) {
    return (
      <Container size="md" py="xl">
        <Text>Work center not found.</Text>
      </Container>
    );
  }

  if (editing) {
    return (
      <Container size="md" py="xl">
        <Title order={2} mb="lg">
          Edit Work Center
        </Title>
        <Stack>
          <TextInput
            label="Key"
            description="Alphanumeric with hyphens"
            value={editKey}
            onChange={(e) => setEditKey(e.currentTarget.value)}
            required
          />
          <Textarea
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.currentTarget.value)}
            autosize
            minRows={2}
          />
          <Group justify="flex-end">
            <Button variant="subtle" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button onClick={handleUpdate} loading={submitting}>
              Save
            </Button>
          </Group>
        </Stack>
      </Container>
    );
  }

  const canAssign = hasAction(wc._actions, "assignUser");

  return (
    <Container size="md" py="xl">
      <Group justify="space-between" mb="lg">
        <Group>
          <Title order={2}>{wc.key}</Title>
          <MetadataTooltip
            createdBy={wc.createdBy}
            createdAt={wc.createdAt}
            updatedBy={wc.updatedBy}
            updatedAt={wc.updatedAt}
          />
        </Group>
        <Group>
          <Button variant="subtle" onClick={() => navigate("/work-centers")}>
            Back
          </Button>
          {hasAction(wc._actions, "update") && (
            <Button onClick={handleEdit}>Edit</Button>
          )}
          {hasAction(wc._actions, "delete") && (
            <Button color="red" variant="outline" onClick={handleDelete}>
              Delete
            </Button>
          )}
        </Group>
      </Group>

      <Card withBorder p="lg" mb="lg">
        <Stack gap="sm">
          <Group>
            <Text fw={600} w={120}>
              Description:
            </Text>
            <Text>{wc.description || "\u2014"}</Text>
          </Group>
        </Stack>
      </Card>

      <Title order={4} mb="sm">
        Assigned Users
      </Title>

      {canAssign && (
        <Group mb="md">
          <UserAutocomplete
            placeholder="Search users..."
            value={newUsername}
            onChange={setNewUsername}
            style={{ flex: 1 }}
          />
          <Button onClick={handleAssignUser} disabled={!newUsername.trim()}>
            Assign
          </Button>
        </Group>
      )}

      {wc.userAssignments.length > 0 ? (
        <Table striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Username</Table.Th>
              <Table.Th>Assigned</Table.Th>
              <Table.Th>By</Table.Th>
              {canAssign && <Table.Th w={50} />}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {wc.userAssignments.map((a) => (
              <Table.Tr key={a.userId}>
                <Table.Td>
                  <Text size="sm">{a.username}</Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm">
                    {new Date(a.createdAt).toLocaleDateString()}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm">{a.createdBy ?? "\u2014"}</Text>
                </Table.Td>
                {canAssign && (
                  <Table.Td>
                    {hasAction(a._actions, "remove") && (
                      <ActionIcon
                        color="red"
                        variant="subtle"
                        size="sm"
                        onClick={() => handleRemoveUser(a.username)}
                      >
                        <IconTrash size="0.9rem" />
                      </ActionIcon>
                    )}
                  </Table.Td>
                )}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      ) : (
        <Text c="dimmed" py="md">
          No users assigned.
        </Text>
      )}
    </Container>
  );
};
