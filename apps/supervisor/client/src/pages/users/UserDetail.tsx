import {
  ActionIcon,
  Alert,
  Button,
  Card,
  Code,
  Container,
  CopyButton,
  Group,
  Loader,
  Modal,
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
import {
  type PasskeyCredential,
  type Permission,
  PermissionDescriptions,
  type RegistrationTokenResponse,
  type UserDetailResponse,
} from "@naisys/supervisor-shared";
import { browserSupportsWebAuthn } from "@simplewebauthn/browser";
import {
  IconCheck,
  IconInfoCircle,
  IconPencil,
  IconX,
} from "@tabler/icons-react";
import { QRCodeSVG } from "qrcode.react";
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
  deleteUserPasskey,
  issueRegistrationLink,
  listUserPasskeys,
  passkeyRegister,
  renameUserPasskey,
  resetUserPasskeys,
} from "../../lib/apiAuth";
import {
  deleteUser,
  getUser,
  grantPermission,
  revokePermission,
  rotateUserApiKey,
  updateUser,
} from "../../lib/apiUsers";

// True when the registration URL points at a loopback address. Phones can't
// reach localhost on the operator's machine, so the QR would be misleading.
function isLoopbackRegistrationUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return (
      host === "localhost" ||
      host === "::1" ||
      host === "0.0.0.0" ||
      /^127\./.test(host)
    );
  } catch {
    return false;
  }
}

export const UserDetail: React.FC = () => {
  const { username: routeUsername } = useParams<{ username: string }>();
  const navigate = useNavigate();
  const { user: currentUser } = useSession();
  const [user, setUser] = useState<UserDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [editOpened, { open: openEdit, close: closeEdit }] = useDisclosure();
  const [editUsername, setEditUsername] = useState("");
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const [grantPerm, setGrantPerm] = useState<Permission | null>(null);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);
  const { permissions: allPermissions } = useOutletContext<AppOutletContext>();

  const [passkeys, setPasskeys] = useState<PasskeyCredential[]>([]);
  const [passkeysLoading, setPasskeysLoading] = useState(false);
  const [passkeyError, setPasskeyError] = useState("");
  const [registering, setRegistering] = useState(false);
  const [
    addPasskeyOpened,
    { open: openAddPasskey, close: closeAddPasskey },
  ] = useDisclosure();
  const [newPasskeyLabel, setNewPasskeyLabel] = useState("");
  const [renamingPasskeyId, setRenamingPasskeyId] = useState<number | null>(
    null,
  );
  const [renameDraft, setRenameDraft] = useState("");
  const [renameSaving, setRenameSaving] = useState(false);
  const [issuedLink, setIssuedLink] =
    useState<RegistrationTokenResponse | null>(null);

  const isSelf = currentUser?.username === routeUsername;

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

  const fetchPasskeys = useCallback(async () => {
    if (!routeUsername) return;
    setPasskeysLoading(true);
    setPasskeyError("");
    try {
      const result = await listUserPasskeys(routeUsername);
      setPasskeys(result.credentials);
    } catch (err) {
      setPasskeyError(
        err instanceof Error ? err.message : "Failed to load passkeys",
      );
    } finally {
      setPasskeysLoading(false);
    }
  }, [routeUsername]);

  useEffect(() => {
    void fetchUser();
    void fetchPasskeys();
  }, [fetchUser, fetchPasskeys]);

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

  const startAddPasskey = () => {
    setNewPasskeyLabel("");
    setPasskeyError("");
    openAddPasskey();
  };

  const handleAddPasskey = async () => {
    const label = newPasskeyLabel.trim();
    setRegistering(true);
    setPasskeyError("");
    try {
      // Pass undefined when blank so the client falls back to its UA-based
      // default; the user can rename afterward via the inline pencil.
      await passkeyRegister({ deviceLabel: label || undefined });
      closeAddPasskey();
      void fetchPasskeys();
    } catch (err) {
      setPasskeyError(
        err instanceof Error ? err.message : "Failed to register passkey",
      );
    } finally {
      setRegistering(false);
    }
  };

  const startRenamePasskey = (id: number, current: string) => {
    setRenamingPasskeyId(id);
    setRenameDraft(current);
    setPasskeyError("");
  };

  const cancelRenamePasskey = () => {
    setRenamingPasskeyId(null);
    setRenameDraft("");
  };

  const saveRenamePasskey = async (id: number) => {
    if (!routeUsername) return;
    setRenameSaving(true);
    try {
      await renameUserPasskey(routeUsername, id, renameDraft.trim());
      setRenamingPasskeyId(null);
      setRenameDraft("");
      void fetchPasskeys();
    } catch (err) {
      setPasskeyError(
        err instanceof Error ? err.message : "Failed to rename passkey",
      );
    } finally {
      setRenameSaving(false);
    }
  };

  const handleDeletePasskey = async (id: number) => {
    if (!routeUsername) return;
    if (
      passkeys.length === 1 &&
      isSelf &&
      !confirm(
        "This is your only passkey. After removing it you'll have no way to sign in until an admin issues a new registration link. Continue?",
      )
    )
      return;
    if (
      passkeys.length > 1 &&
      !confirm("Remove this passkey? It can't be recovered.")
    )
      return;
    try {
      await deleteUserPasskey(routeUsername, id);
      void fetchPasskeys();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to remove passkey");
    }
  };

  const handleIssueRegistrationLink = async () => {
    if (!routeUsername) return;
    try {
      const result = await issueRegistrationLink(routeUsername);
      setIssuedLink(result);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to issue link");
    }
  };

  const handleResetPasskeys = async () => {
    if (!routeUsername) return;
    if (
      !confirm(
        `Wipe all passkeys for ${routeUsername} and issue a new registration link? Use this when the user has lost all their devices.`,
      )
    )
      return;
    try {
      const result = await resetUserPasskeys(routeUsername);
      setIssuedLink(result);
      void fetchPasskeys();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to reset passkeys");
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
    (p) => !user.permissions?.some((up) => up.permission === p),
  );

  const canIssueRegistration = hasAction(user._actions, "issue-registration");
  const canResetPasskeys = hasAction(user._actions, "reset-passkeys");
  const supportsWebAuthn = browserSupportsWebAuthn();

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
        </Stack>
      </Card>

      {!user.isAgent && (
        <>
          <Group justify="space-between" mb="sm" align="center">
            <Title order={3}>Passkeys</Title>
            <Group gap="xs">
              {/* First-passkey enrollment must go through a registration
                  link — server rejects authenticated-no-token register when
                  the caller has zero passkeys. Hide the button to match. */}
              {isSelf && passkeys.length > 0 && (
                <Button
                  variant="outline"
                  onClick={startAddPasskey}
                  disabled={!supportsWebAuthn}
                >
                  Add passkey on this device
                </Button>
              )}
              {/* Self-issuance is server-rejected for zero-passkey callers
                  (an admin must bootstrap the first credential). Hide the
                  button rather than letting it 403. */}
              {canIssueRegistration && !(isSelf && passkeys.length === 0) && (
                <Button variant="light" onClick={handleIssueRegistrationLink}>
                  {isSelf
                    ? "Issue registration link for new device"
                    : "Issue registration link"}
                </Button>
              )}
              {canResetPasskeys && (
                <Button
                  color="red"
                  variant="outline"
                  onClick={handleResetPasskeys}
                >
                  Reset all passkeys
                </Button>
              )}
            </Group>
          </Group>

          {passkeyError && (
            <Alert color="red" variant="light" mb="md">
              {passkeyError}
            </Alert>
          )}

          {issuedLink && (
            <Alert color="blue" variant="light" mb="md">
              <Stack gap="xs">
                <Text size="sm">
                  Registration link for <b>{issuedLink.username}</b> (expires{" "}
                  {new Date(issuedLink.expiresAt).toLocaleString()}):
                </Text>
                <Group align="flex-start" wrap="nowrap">
                  {!isLoopbackRegistrationUrl(issuedLink.registrationUrl) && (
                    <div style={{ background: "white", padding: 8 }}>
                      <QRCodeSVG
                        value={issuedLink.registrationUrl}
                        size={160}
                        level="M"
                      />
                    </div>
                  )}
                  <Stack gap="xs" style={{ flex: 1, minWidth: 0 }}>
                    <Code
                      block
                      style={{
                        wordBreak: "break-all",
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      {issuedLink.registrationUrl}
                    </Code>
                    <Group>
                      <CopyButton value={issuedLink.registrationUrl}>
                        {({ copied, copy }) => (
                          <Button size="xs" variant="light" onClick={copy}>
                            {copied ? "Copied" : "Copy"}
                          </Button>
                        )}
                      </CopyButton>
                      <Button
                        size="xs"
                        variant="subtle"
                        onClick={() => setIssuedLink(null)}
                      >
                        Dismiss
                      </Button>
                    </Group>
                    {isLoopbackRegistrationUrl(issuedLink.registrationUrl) && (
                      <Text size="xs" c="dimmed">
                        QR hidden — link points to localhost and won't be
                        reachable from another device. Set{" "}
                        <Code>SUPERVISOR_WEBAUTHN_ORIGIN</Code> to a
                        LAN-reachable URL to enable QR enrollment from phones.
                      </Text>
                    )}
                  </Stack>
                </Group>
              </Stack>
            </Alert>
          )}

          {passkeysLoading ? (
            <Loader size="sm" />
          ) : passkeys.length > 0 ? (
            <Table striped withTableBorder mb="lg">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Device</Table.Th>
                  <Table.Th>Registered</Table.Th>
                  <Table.Th>Last used</Table.Th>
                  <Table.Th></Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {passkeys.map((p) => (
                  <Table.Tr key={p.id}>
                    <Table.Td>
                      {renamingPasskeyId === p.id ? (
                        <Group gap="xs" wrap="nowrap">
                          <TextInput
                            size="xs"
                            value={renameDraft}
                            onChange={(e) =>
                              setRenameDraft(e.currentTarget.value)
                            }
                            disabled={renameSaving}
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === "Enter") void saveRenamePasskey(p.id);
                              else if (e.key === "Escape") cancelRenamePasskey();
                            }}
                            style={{ flex: 1 }}
                          />
                          <ActionIcon
                            size="sm"
                            variant="subtle"
                            color="green"
                            onClick={() => void saveRenamePasskey(p.id)}
                            loading={renameSaving}
                            aria-label="Save label"
                          >
                            <IconCheck size={14} />
                          </ActionIcon>
                          <ActionIcon
                            size="sm"
                            variant="subtle"
                            onClick={cancelRenamePasskey}
                            disabled={renameSaving}
                            aria-label="Cancel"
                          >
                            <IconX size={14} />
                          </ActionIcon>
                        </Group>
                      ) : (
                        <Group gap="xs" wrap="nowrap">
                          {p.deviceLabel || (
                            <Text c="dimmed">(unlabeled)</Text>
                          )}
                          <ActionIcon
                            size="sm"
                            variant="subtle"
                            onClick={() =>
                              startRenamePasskey(p.id, p.deviceLabel)
                            }
                            aria-label="Rename"
                          >
                            <IconPencil size={14} />
                          </ActionIcon>
                        </Group>
                      )}
                    </Table.Td>
                    <Table.Td>
                      {new Date(p.createdAt).toLocaleDateString()}
                    </Table.Td>
                    <Table.Td>
                      {p.lastUsedAt
                        ? new Date(p.lastUsedAt).toLocaleString()
                        : "—"}
                    </Table.Td>
                    <Table.Td>
                      <Button
                        size="xs"
                        color="red"
                        variant="subtle"
                        onClick={() => handleDeletePasskey(p.id)}
                      >
                        Remove
                      </Button>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          ) : (
            <Text c="dimmed" mb="lg">
              No passkeys registered yet.
            </Text>
          )}
        </>
      )}

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
          <Group align="flex-start">
            <Select
              placeholder="Select permission"
              w={320}
              data={grantablePermissions.map((p) => ({
                value: p,
                label: p,
              }))}
              renderOption={({ option }) => (
                <Stack gap={2}>
                  <Text ff="monospace" size="sm">
                    {option.label}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {PermissionDescriptions[option.value as Permission]}
                  </Text>
                </Stack>
              )}
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

      <Modal
        opened={addPasskeyOpened}
        onClose={() => {
          if (!registering) closeAddPasskey();
        }}
        title="Add passkey"
        centered
        closeOnClickOutside={!registering}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleAddPasskey();
          }}
        >
          <Stack>
            <Text size="sm" c="dimmed">
              Pick a label that will help you tell this credential apart from
              your others (e.g. <Code>YubiKey 5C</Code>, <Code>iPhone</Code>,{" "}
              <Code>Touch ID</Code>). The label is purely for display — leave
              blank to auto-fill from this device's user-agent.
            </Text>
            <TextInput
              label="Device label"
              placeholder="e.g. YubiKey 5C"
              value={newPasskeyLabel}
              onChange={(e) => setNewPasskeyLabel(e.currentTarget.value)}
              maxLength={64}
              disabled={registering}
              autoFocus
            />
            {passkeyError && (
              <Text c="red" size="sm">
                {passkeyError}
              </Text>
            )}
            <Group justify="flex-end">
              <Button
                variant="subtle"
                type="button"
                onClick={closeAddPasskey}
                disabled={registering}
              >
                Cancel
              </Button>
              <Button type="submit" loading={registering}>
                Register
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </Container>
  );
};
