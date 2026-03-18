import {
  Button,
  Card,
  Container,
  Group,
  Loader,
  Modal,
  PasswordInput,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { SecretField } from "@naisys/common-browser";
import {
  type ErpPermission,
  ErpPermissionEnum,
  type User,
} from "@naisys-erp/shared";
import { IconAlertTriangle } from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useOutletContext, useParams } from "react-router";

import type { AppOutletContext } from "../../components/AppLayout";
import { MetadataTooltip } from "../../components/MetadataTooltip";
import { api, apiEndpoints, showErrorNotification } from "../../lib/api";
import { hasAction } from "../../lib/hateoas";

export const UserDetail: React.FC = () => {
  const { username: routeUsername } = useParams<{ username: string }>();
  const navigate = useNavigate();
  const { supervisorAuth } = useOutletContext<AppOutletContext>();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [editOpened, { open: openEdit, close: closeEdit }] = useDisclosure();
  const [editUsername, setEditUsername] = useState("");
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const [grantPerm, setGrantPerm] = useState<ErpPermission | null>(null);
  const [rotating, setRotating] = useState(false);
  const [pwOpened, { open: openPw, close: closePw }] = useDisclosure();
  const [newPassword, setNewPassword] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState("");

  const fetchUser = useCallback(async () => {
    if (!routeUsername) return;
    setLoading(true);
    try {
      const result = await api.get<User>(apiEndpoints.user(routeUsername));
      setUser(result);
    } catch {
      // handled
    } finally {
      setLoading(false);
    }
  }, [routeUsername]);

  useEffect(() => {
    void fetchUser();
  }, [fetchUser]);

  const handleDelete = async () => {
    if (!routeUsername || !confirm("Delete this user?")) return;
    try {
      await api.delete(apiEndpoints.user(routeUsername));
      void navigate("/users");
    } catch (err) {
      showErrorNotification(err);
    }
  };

  const handleUpdate = async () => {
    if (!routeUsername || !editUsername) return;
    setSaving(true);
    setEditError("");
    try {
      await api.put(apiEndpoints.user(routeUsername), {
        username: editUsername,
      });
      closeEdit();
      if (editUsername !== routeUsername) {
        void navigate(`/users/${editUsername}`, { replace: true });
      } else {
        void fetchUser();
      }
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
      await api.post(apiEndpoints.changePassword, { password: newPassword });
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
    if (!routeUsername || !grantPerm) return;
    try {
      await api.post(apiEndpoints.userPermissions(routeUsername), {
        permission: grantPerm,
      });
      setGrantPerm(null);
      void fetchUser();
    } catch (err) {
      showErrorNotification(err);
    }
  };

  const handleRevokePermission = async (permission: ErpPermission) => {
    if (!routeUsername) return;
    try {
      await api.delete(apiEndpoints.userPermission(routeUsername, permission));
      void fetchUser();
    } catch (err) {
      showErrorNotification(err);
    }
  };

  const handleRotateKey = async () => {
    if (!routeUsername) return;
    if (
      !confirm(
        "Rotate this user's API key? The old key will stop working immediately.",
      )
    )
      return;
    setRotating(true);
    try {
      await api.post(apiEndpoints.userRotateKey(routeUsername), {});
      void fetchUser();
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setRotating(false);
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

  const allPermissions = ErpPermissionEnum.options;
  const grantablePermissions = allPermissions.filter(
    (p) => !user.permissions?.some((up) => up.permission === p),
  );

  return (
    <Container size="md" py="xl">
      <Group justify="space-between" mb="lg">
        <Group>
          <Title order={2}>{user.username}</Title>
          <MetadataTooltip
            createdAt={user.createdAt}
            updatedAt={user.updatedAt}
          />
        </Group>
        <Group>
          <Button variant="subtle" onClick={() => navigate("/users")}>
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

      {user.isAgent && !supervisorAuth && (
        <Card withBorder p="sm" mb="lg" bg="var(--mantine-color-red-light)">
          <Group gap="xs" wrap="nowrap">
            <IconAlertTriangle size={18} color="var(--mantine-color-red-6)" />
            <Text size="sm">
              This is an agent user but ERP is running without supervisor auth.
              API key lookups and agent authentication will not work.
            </Text>
          </Group>
        </Card>
      )}

      <Card withBorder p="lg" mb="lg">
        <Stack gap="sm">
          <Group>
            <Text fw={600} w={120}>
              Username:
            </Text>
            <Text ff="monospace">{user.username}</Text>
          </Group>
          <Group>
            <Text fw={600} w={120}>
              Type:
            </Text>
            <Text>{user.isAgent ? "Agent" : "User"}</Text>
          </Group>
          {(user.apiKey || hasAction(user._actions, "rotate-key")) && (
            <Group>
              <Text fw={600} w={120}>
                API Key:
              </Text>
              <SecretField
                value={user.apiKey ?? null}
                onRotate={
                  hasAction(user._actions, "rotate-key")
                    ? handleRotateKey
                    : undefined
                }
                rotating={rotating}
              />
            </Group>
          )}
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
            {user.permissions.map((p) => (
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
              onChange={(v) => setGrantPerm(v as ErpPermission | null)}
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
