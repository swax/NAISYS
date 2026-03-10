import { Text, UnstyledButton } from "@mantine/core";
import React from "react";
import { Link, useLocation } from "react-router-dom";

import { useSession } from "../contexts/SessionContext";

interface AppNavbarProps {
  onClose: () => void;
  hasErp: boolean;
}

export const AppNavbar: React.FC<AppNavbarProps> = ({ onClose, hasErp }) => {
  const location = useLocation();
  const { hasPermission } = useSession();

  const isAgentsPage = location.pathname.startsWith("/agents");
  const isHostsPage = location.pathname.startsWith("/hosts");
  const isModelsPage = location.pathname.startsWith("/models");
  const isVariablesPage = location.pathname.startsWith("/variables");
  const isUsersPage = location.pathname.startsWith("/users");
  const isAdminPage = location.pathname.startsWith("/admin");
  const showVariablesTab = hasPermission("manage_variables");
  const showUsersTab = hasPermission("supervisor_admin");
  const showAdminTab = hasPermission("supervisor_admin");

  return (
    <>
      <UnstyledButton
        component={Link}
        to="/agents"
        onClick={onClose}
        p="sm"
        mb={4}
        style={(theme) => ({
          borderRadius: theme.radius.sm,
          backgroundColor: isAgentsPage
            ? "var(--mantine-color-dark-5)"
            : undefined,
        })}
      >
        <Text
          size="sm"
          fw={isAgentsPage ? 600 : 400}
          c={!isAgentsPage ? "dimmed" : undefined}
        >
          Agents
        </Text>
      </UnstyledButton>
      <UnstyledButton
        component={Link}
        to="/hosts"
        onClick={onClose}
        p="sm"
        mb={4}
        style={(theme) => ({
          borderRadius: theme.radius.sm,
          backgroundColor: isHostsPage
            ? "var(--mantine-color-dark-5)"
            : undefined,
        })}
      >
        <Text
          size="sm"
          fw={isHostsPage ? 600 : 400}
          c={!isHostsPage ? "dimmed" : undefined}
        >
          Hosts
        </Text>
      </UnstyledButton>
      <UnstyledButton
        component={Link}
        to="/models"
        onClick={onClose}
        p="sm"
        mb={4}
        style={(theme) => ({
          borderRadius: theme.radius.sm,
          backgroundColor: isModelsPage
            ? "var(--mantine-color-dark-5)"
            : undefined,
        })}
      >
        <Text
          size="sm"
          fw={isModelsPage ? 600 : 400}
          c={!isModelsPage ? "dimmed" : undefined}
        >
          Models
        </Text>
      </UnstyledButton>
      {showVariablesTab && (
        <UnstyledButton
          component={Link}
          to="/variables"
          onClick={onClose}
          p="sm"
          mb={4}
          style={(theme) => ({
            borderRadius: theme.radius.sm,
            backgroundColor: isVariablesPage
              ? "var(--mantine-color-dark-5)"
              : undefined,
          })}
        >
          <Text
            size="sm"
            fw={isVariablesPage ? 600 : 400}
            c={!isVariablesPage ? "dimmed" : undefined}
          >
            Variables
          </Text>
        </UnstyledButton>
      )}
      {showUsersTab && (
        <UnstyledButton
          component={Link}
          to="/users"
          onClick={onClose}
          p="sm"
          mb={4}
          style={(theme) => ({
            borderRadius: theme.radius.sm,
            backgroundColor: isUsersPage
              ? "var(--mantine-color-dark-5)"
              : undefined,
          })}
        >
          <Text
            size="sm"
            fw={isUsersPage ? 600 : 400}
            c={!isUsersPage ? "dimmed" : undefined}
          >
            Users
          </Text>
        </UnstyledButton>
      )}
      {showAdminTab && (
        <UnstyledButton
          component={Link}
          to="/admin"
          onClick={onClose}
          p="sm"
          mb={4}
          style={(theme) => ({
            borderRadius: theme.radius.sm,
            backgroundColor: isAdminPage
              ? "var(--mantine-color-dark-5)"
              : undefined,
          })}
        >
          <Text
            size="sm"
            fw={isAdminPage ? 600 : 400}
            c={!isAdminPage ? "dimmed" : undefined}
          >
            Admin
          </Text>
        </UnstyledButton>
      )}
      {hasErp && (
        <UnstyledButton
          component="a"
          href="/erp/"
          p="sm"
          mb={4}
          style={(theme) => ({
            borderRadius: theme.radius.sm,
            textDecoration: "none",
            color: "inherit",
          })}
        >
          <Text size="sm" c="dimmed">
            ERP
          </Text>
        </UnstyledButton>
      )}
    </>
  );
};
