import {
  Container,
  Title,
  Group,
  Button,
  Text,
  Loader,
  Stack,
  Card,
  Table,
  Select,
  TextInput,
  PasswordInput,
  Modal,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { hasAction } from "@naisys/common";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useSession } from "../../contexts/SessionContext";
import {
  getUser,
  updateUser,
  deleteUser,
  grantPermission,
  revokePermission,
  changePassword,
} from "../../lib/apiUsers";

// Keep in sync with PermissionEnum in shared/src/user-types.ts
const ALL_PERMISSIONS = [
  "supervisor_admin",
  "manage_agents",
  "agent_communication",
  "manage_models",
  "manage_variables",
];

export const UserDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { hasPermission } = useSession();
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [editOpened, { open: openEdit, close: closeEdit }] = useDisclosure();
  const [editUsername, setEditUsername] = useState("");
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const [grantPerm, setGrantPerm] = useState<string | null>(null);
  const [pwOpened, { open: openPw, close: closePw }] = useDisclosure();
  const [newPassword, setNewPassword] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState("");

  const fetchUser = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const result = await getUser(Number(id));
      setUser(result);
    } catch {
      // error handled silently
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  const handleDelete = async () => {
    if (!id || !confirm("Delete this user?")) return;
    try {
      await deleteUser(Number(id));
      navigate("/users");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete user");
    }
  };

  const handleUpdate = async () => {
    if (!id || !editUsername) return;
    setSaving(true);
    setEditError("");
    try {
      await updateUser(Number(id), { username: editUsername });
      closeEdit();
      fetchUser();
    } catch (err) {
      setEditError(
        err instanceof Error ? err.message : "Failed to update user",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    if (!newPassword) return;
    setPwSaving(true);
    setPwError("");
    try {
      await changePassword(newPassword);
      closePw();
      setNewPassword("");
    } catch (err) {
      setPwError(
        err instanceof Error ? err.message : "Failed to change password",
      );
    } finally {
      setPwSaving(false);
    }
  };

  const handleGrantPermission = async () => {
    if (!id || !grantPerm) return;
    try {
      await grantPermission(Number(id), grantPerm);
      setGrantPerm(null);
      fetchUser();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to grant permission");
    }
  };

  const handleRevokePermission = async (permission: string) => {
    if (!id) return;
    try {
      await revokePermission(Number(id), permission);
      fetchUser();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to revoke permission");
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

  if (!user) {
    return (
      <Container size="md" py="xl">
        <Text>User not found.</Text>
      </Container>
    );
  }

  const grantablePermissions = ALL_PERMISSIONS.filter(
    (p) => !user.permissions?.some((up: any) => up.permission === p),
  );

  return (
    <Container size="md" py="xl">
      <Group justify="space-between" mb="lg">
        <Title order={2}>{user.username}</Title>
        <Group>
          <Button
            variant="subtle"
            onClick={() =>
              navigate(hasPermission("supervisor_admin") ? "/users" : "/agents")
            }
          >
            Back
          </Button>
          {hasAction(user._actions, "change-password") && (
            <Button
              variant="outline"
              onClick={() => {
                setNewPassword("");
                setPwError("");
                openPw();
              }}
            >
              Change Password
            </Button>
          )}
          {hasAction(user._actions, "update") && (
            <Button
              onClick={() => {
                setEditUsername(user.username);
                setEditError("");
                openEdit();
              }}
            >
              Edit
            </Button>
          )}
          {hasAction(user._actions, "delete") && (
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
              ID:
            </Text>
            <Text>{user.id}</Text>
          </Group>
          <Group>
            <Text fw={600} w={120}>
              Auth Type:
            </Text>
            <Text>{user.authType}</Text>
          </Group>
          <Group>
            <Text fw={600} w={120}>
              Created:
            </Text>
            <Text>{new Date(user.createdAt).toLocaleString()}</Text>
          </Group>
          <Group>
            <Text fw={600} w={120}>
              Updated:
            </Text>
            <Text>{new Date(user.updatedAt).toLocaleString()}</Text>
          </Group>
        </Stack>
      </Card>

      <Title order={3} mb="sm">
        Permissions
      </Title>

      {user.permissions && user.permissions.length > 0 ? (
        <Table striped withTableBorder mb="md">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Permission</Table.Th>
              <Table.Th>Granted At</Table.Th>
              <Table.Th>Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {user.permissions.map((p: any) => (
              <Table.Tr key={p.permission}>
                <Table.Td>
                  <Text ff="monospace">{p.permission}</Text>
                </Table.Td>
                <Table.Td>{new Date(p.grantedAt).toLocaleString()}</Table.Td>
                <Table.Td>
                  {hasAction(p._actions, "revoke") && (
                    <Button
                      size="xs"
                      color="red"
                      variant="subtle"
                      onClick={() => handleRevokePermission(p.permission)}
                    >
                      Revoke
                    </Button>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      ) : (
        <Text c="dimmed" mb="md">
          No permissions granted.
        </Text>
      )}

      {hasAction(user._actions, "grant-permission") &&
        grantablePermissions.length > 0 && (
          <Group>
            <Select
              placeholder="Select permission"
              data={grantablePermissions.map((p) => ({
                value: p,
                label: p,
              }))}
              value={grantPerm}
              onChange={setGrantPerm}
            />
            <Button onClick={handleGrantPermission} disabled={!grantPerm}>
              Grant
            </Button>
          </Group>
        )}

      <Modal opened={editOpened} onClose={closeEdit} title="Edit User">
        <Stack>
          <TextInput
            label="Username"
            value={editUsername}
            onChange={(e) => setEditUsername(e.currentTarget.value)}
          />
          {editError && (
            <Text c="red" size="sm">
              {editError}
            </Text>
          )}
          <Group justify="flex-end">
            <Button variant="subtle" onClick={closeEdit}>
              Cancel
            </Button>
            <Button onClick={handleUpdate} loading={saving}>
              Save
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={pwOpened} onClose={closePw} title="Change Password">
        <Stack>
          <PasswordInput
            label="New Password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.currentTarget.value)}
          />
          {pwError && (
            <Text c="red" size="sm">
              {pwError}
            </Text>
          )}
          <Group justify="flex-end">
            <Button variant="subtle" onClick={closePw}>
              Cancel
            </Button>
            <Button onClick={handleChangePassword} loading={pwSaving}>
              Save
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Container>
  );
};
