import {
  ActionIcon,
  Button,
  Card,
  Code,
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
  Tooltip,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { hasAction } from "@naisys/common";
import { SecretField } from "@naisys/common-browser";
import type { Permission } from "@naisys/supervisor-shared";
import { IconInfoCircle } from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";
import {
  Link,
  useNavigate,
  useOutletContext,
  useParams,
} from "react-router-dom";

import type { AppOutletContext } from "../../App";
import {
  changePassword,
  deleteUser,
  getUser,
  grantPermission,
  revokePermission,
  rotateUserApiKey,
  updateUser,
} from "../../lib/apiUsers";

export const UserDetail: React.FC = () => {
  const { username: routeUsername } = useParams<{ username: string }>();
  const navigate = useNavigate();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [editOpened, { open: openEdit, close: closeEdit }] = useDisclosure();
  const [editUsername, setEditUsername] = useState("");
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const [grantPerm, setGrantPerm] = useState<Permission | null>(null);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);
  const [pwOpened, { open: openPw, close: closePw }] = useDisclosure();
  const [newPassword, setNewPassword] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState("");
  const { permissions: allPermissions } = useOutletContext<AppOutletContext>();

  const fetchUser = useCallback(async () => {
    if (!routeUsername) return;
    setLoading(true);
    try {
      const result = await getUser(routeUsername);
      setUser(result);
      setApiKey(result.apiKey ?? null);
    } catch {
      // error handled silently
    } finally {
      setLoading(false);
    }
  }, [routeUsername]);

  useEffect(() => {
    void fetchUser();
  }, [fetchUser]);

  const handleDelete = async () => {
    if (!routeUsername) return;
    const isAdmin = user?.permissions?.some(
      (p: any) => p.permission === "supervisor_admin",
    );
    if (isAdmin) {
      if (
        !confirm(
          "Warning: This user has supervisor_admin permissions. Deleting them may remove your ability to manage the system. Are you absolutely sure?",
        )
      )
        return;
    } else if (!confirm("Delete this user?")) {
      return;
    }
    try {
      await deleteUser(routeUsername);
      void navigate("/users");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete user");
    }
  };

  const handleUpdate = async () => {
    if (!routeUsername || !editUsername) return;
    setSaving(true);
    setEditError("");
    try {
      await updateUser(routeUsername, { username: editUsername });
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
    if (!routeUsername || !grantPerm) return;
    try {
      await grantPermission(routeUsername, grantPerm);
      setGrantPerm(null);
      void fetchUser();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to grant permission");
    }
  };

  const handleRevokePermission = async (permission: Permission) => {
    if (!routeUsername) return;
    try {
      await revokePermission(routeUsername, permission);
      void fetchUser();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to revoke permission");
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
      await rotateUserApiKey(routeUsername);
      void fetchUser();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to rotate API key");
    } finally {
      setRotating(false);
    }
  };

  if (loading) {
    return (
      <Container size="md" py="xl" w="100%">
        <Stack align="center">
          <Loader />
        </Stack>
      </Container>
    );
  }

  if (!user) {
    return (
      <Container size="md" py="xl" w="100%">
        <Text>User not found.</Text>
      </Container>
    );
  }

  const grantablePermissions = allPermissions.filter(
    (p) => !user.permissions?.some((up: any) => up.permission === p),
  );

  return (
    <Container size="md" py="xl" w="100%">
      <Group justify="space-between" mb="lg">
        <Group>
          <Title order={2}>{user.username}</Title>
          <Tooltip
            label={
              <Stack gap={4}>
                <Text size="xs">
                  Created, {new Date(user.createdAt).toLocaleString()}
                </Text>
                <Text size="xs">
                  Modified, {new Date(user.updatedAt).toLocaleString()}
                </Text>
              </Stack>
            }
            multiline
            withArrow
          >
            <ActionIcon variant="subtle" size="sm" color="gray">
              <IconInfoCircle size={16} />
            </ActionIcon>
          </Tooltip>
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

      <Card withBorder p="lg" mb="lg">
        <Stack gap="sm">
          <Group>
            <Text fw={600} w={120}>
              Type:
            </Text>
            <Text>{user.isAgent ? "Agent" : "User"}</Text>
          </Group>
          {(() => {
            const agentLink = user._links?.find((l: any) => l.rel === "agent");
            if (!agentLink) return null;
            const agentUsername =
              agentLink.href.match(/\/agents\/([^/]+)/)?.[1];
            if (!agentUsername) return null;
            return (
              <Group>
                <Text fw={600} w={120}>
                  Agent:
                </Text>
                <Text
                  component={Link}
                  to={`/agents/${agentUsername}`}
                  c="blue"
                  td="underline"
                >
                  View Agent
                </Text>
              </Group>
            );
          })()}
          {(user.hasApiKey || hasAction(user._actions, "rotate-key")) && (
            <Group>
              <Text fw={600} w={120}>
                API Key:
              </Text>
              {apiKey !== null || hasAction(user._actions, "rotate-key") ? (
                <SecretField
                  value={apiKey}
                  onRotate={
                    hasAction(user._actions, "rotate-key")
                      ? handleRotateKey
                      : undefined
                  }
                  rotating={rotating}
                />
              ) : (
                <Code>
                  {"\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"}
                </Code>
              )}
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
              onChange={(v) => setGrantPerm(v as Permission | null)}
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
