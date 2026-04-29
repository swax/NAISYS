import {
  ActionIcon,
  Button,
  Card,
  Code,
  Container,
  Group,
  Loader,
  Modal,
  Stack,
  Text,
  TextInput,
  Title,
  Tooltip,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { hasAction } from "@naisys/common";
import { SecretField } from "@naisys/common-browser";
import { type UserDetailResponse } from "@naisys/supervisor-shared";
import { IconInfoCircle } from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";
import {
  Link,
  useNavigate,
  useOutletContext,
  useParams,
} from "react-router-dom";

import type { AppOutletContext } from "../../App";
import { useSession } from "../../contexts/SessionContext";
import {
  clearUserPassword,
  deleteUser,
  getUser,
  rotateUserApiKey,
  updateUser,
} from "../../lib/apiUsers";
import { UserPasskeysSection } from "./UserPasskeysSection";
import { UserPermissionsSection } from "./UserPermissionsSection";

export const UserDetail: React.FC = () => {
  const { username: routeUsername } = useParams<{ username: string }>();
  const navigate = useNavigate();
  const { user: currentUser } = useSession();
  const { allowPasswordLogin } = useOutletContext<AppOutletContext>();
  const [user, setUser] = useState<UserDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [editOpened, { open: openEdit, close: closeEdit }] = useDisclosure();
  const [editUsername, setEditUsername] = useState("");
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);
  const [clearingPassword, setClearingPassword] = useState(false);

  const isSelf = currentUser?.username === routeUsername;

  const fetchUser = useCallback(async () => {
    if (!routeUsername) return;
    setLoading(true);
    try {
      const result = await getUser(routeUsername);
      setUser(result);
      setApiKey(null);
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
      (p) => p.permission === "supervisor_admin",
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
      notifications.show({
        title: "Delete Failed",
        message: err instanceof Error ? err.message : "Failed to delete user",
        color: "red",
      });
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

  const handleClearPassword = async () => {
    if (!routeUsername) return;
    if (
      !confirm(
        `Remove password sign-in for ${routeUsername}? Passkey sign-in will remain available.`,
      )
    ) {
      return;
    }
    setClearingPassword(true);
    try {
      await clearUserPassword(routeUsername);
      void fetchUser();
    } catch (err) {
      notifications.show({
        title: "Remove Password Failed",
        message:
          err instanceof Error ? err.message : "Failed to remove password",
        color: "red",
      });
    } finally {
      setClearingPassword(false);
    }
  };

  const handleRotateKey = async () => {
    if (!routeUsername) return;
    if (
      !confirm(
        "Generate a new API key? The old key will stop working immediately.",
      )
    )
      return;
    setRotating(true);
    try {
      const result = await rotateUserApiKey(routeUsername);
      setApiKey(result.apiKey ?? null);
      setUser((current) =>
        current ? { ...current, hasApiKey: !!result.apiKey } : current,
      );
    } catch (err) {
      notifications.show({
        title: "Rotate Failed",
        message:
          err instanceof Error ? err.message : "Failed to rotate API key",
        color: "red",
      });
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
            const agentLink = user._links?.find((l) => l.rel === "agent");
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
                  emptyLabel={user.hasApiKey ? "Generated (hidden)" : "Not set"}
                  onRotate={
                    hasAction(user._actions, "rotate-key")
                      ? handleRotateKey
                      : undefined
                  }
                  rotating={rotating}
                />
              ) : (
                <Code>{"••••••••••••••••"}</Code>
              )}
            </Group>
          )}
          {allowPasswordLogin && !user.isAgent && (
            <Group>
              <Text fw={600} w={120}>
                Password:
              </Text>
              <Text>{user.hasPassword ? "Set" : "Not set"}</Text>
              {user.hasPassword &&
                hasAction(user._actions, "clear-password") && (
                  <Button
                    size="xs"
                    color="red"
                    variant="subtle"
                    loading={clearingPassword}
                    onClick={handleClearPassword}
                  >
                    Remove
                  </Button>
                )}
            </Group>
          )}
        </Stack>
      </Card>

      {!user.isAgent && (
        <UserPasskeysSection
          routeUsername={user.username}
          isSelf={isSelf}
          userActions={user._actions}
          hasPassword={user.hasPassword}
          allowPasswordLogin={allowPasswordLogin}
        />
      )}

      <UserPermissionsSection
        routeUsername={user.username}
        permissions={user.permissions}
        userActions={user._actions}
        onChange={fetchUser}
      />

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
    </Container>
  );
};
