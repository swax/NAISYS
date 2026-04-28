import {
  Button,
  Group,
  Select,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { hasAction } from "@naisys/common";
import {
  type Permission,
  PermissionDescriptions,
  type UserDetailResponse,
} from "@naisys/supervisor-shared";
import React, { useState } from "react";
import { useOutletContext } from "react-router-dom";

import type { AppOutletContext } from "../../App";
import { grantPermission, revokePermission } from "../../lib/apiUsers";

interface UserPermissionsSectionProps {
  routeUsername: string;
  permissions: UserDetailResponse["permissions"];
  userActions: UserDetailResponse["_actions"];
  onChange: () => void;
}

export const UserPermissionsSection: React.FC<UserPermissionsSectionProps> = ({
  routeUsername,
  permissions,
  userActions,
  onChange,
}) => {
  const [grantPerm, setGrantPerm] = useState<Permission | null>(null);
  const { permissions: allPermissions } = useOutletContext<AppOutletContext>();

  const grantablePermissions = allPermissions.filter(
    (p) => !permissions?.some((up) => up.permission === p),
  );

  const handleGrantPermission = async () => {
    if (!grantPerm) return;
    try {
      await grantPermission(routeUsername, grantPerm);
      setGrantPerm(null);
      onChange();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to grant permission");
    }
  };

  const handleRevokePermission = async (permission: Permission) => {
    try {
      await revokePermission(routeUsername, permission);
      onChange();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to revoke permission");
    }
  };

  return (
    <>
      <Title order={3} mb="sm">
        Permissions
      </Title>

      {permissions && permissions.length > 0 ? (
        <Table striped withTableBorder mb="md">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Permission</Table.Th>
              <Table.Th>Granted At</Table.Th>
              <Table.Th>Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {permissions.map((p) => (
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

      {hasAction(userActions, "grant-permission") &&
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
    </>
  );
};
