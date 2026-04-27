import {
  ActionIcon,
  Alert,
  Button,
  Code,
  CopyButton,
  Group,
  Loader,
  Modal,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { hasAction } from "@naisys/common";
import {
  type PasskeyCredential,
  type RegistrationTokenResponse,
  type UserDetailResponse,
} from "@naisys/supervisor-shared";
import { browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { IconCheck, IconPencil, IconX } from "@tabler/icons-react";
import { QRCodeSVG } from "qrcode.react";
import React, { useCallback, useEffect, useState } from "react";

import {
  deleteUserPasskey,
  issueRegistrationLink,
  listUserPasskeys,
  passkeyRegister,
  renameUserPasskey,
  resetUserPasskeys,
} from "../../lib/apiAuth";

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

interface UserPasskeysSectionProps {
  routeUsername: string;
  isSelf: boolean;
  userActions: UserDetailResponse["_actions"];
}

export const UserPasskeysSection: React.FC<UserPasskeysSectionProps> = ({
  routeUsername,
  isSelf,
  userActions,
}) => {
  const [passkeys, setPasskeys] = useState<PasskeyCredential[]>([]);
  const [passkeysLoading, setPasskeysLoading] = useState(false);
  const [passkeyError, setPasskeyError] = useState("");
  const [registering, setRegistering] = useState(false);
  const [addPasskeyOpened, { open: openAddPasskey, close: closeAddPasskey }] =
    useDisclosure();
  const [newPasskeyLabel, setNewPasskeyLabel] = useState("");
  const [renamingPasskeyId, setRenamingPasskeyId] = useState<number | null>(
    null,
  );
  const [renameDraft, setRenameDraft] = useState("");
  const [renameSaving, setRenameSaving] = useState(false);
  const [issuedLink, setIssuedLink] =
    useState<RegistrationTokenResponse | null>(null);

  const fetchPasskeys = useCallback(async () => {
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
    void fetchPasskeys();
  }, [fetchPasskeys]);

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
    try {
      const result = await issueRegistrationLink(routeUsername);
      setIssuedLink(result);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to issue link");
    }
  };

  const handleResetPasskeys = async () => {
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

  const canIssueRegistration = hasAction(userActions, "issue-registration");
  const canResetPasskeys = hasAction(userActions, "reset-passkeys");
  const supportsWebAuthn = browserSupportsWebAuthn();

  return (
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
            <Button color="red" variant="outline" onClick={handleResetPasskeys}>
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
                    QR hidden — link points to localhost and won't be reachable
                    from another device. Set{" "}
                    <Code>SUPERVISOR_WEBAUTHN_ORIGIN</Code> to a LAN-reachable
                    URL to enable QR enrollment from phones.
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
                        onChange={(e) => setRenameDraft(e.currentTarget.value)}
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
                      {p.deviceLabel || <Text c="dimmed">(unlabeled)</Text>}
                      <ActionIcon
                        size="sm"
                        variant="subtle"
                        onClick={() => startRenamePasskey(p.id, p.deviceLabel)}
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
    </>
  );
};
