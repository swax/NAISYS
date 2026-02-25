import {
  ActionIcon,
  Box,
  Burger,
  Button,
  Group,
  Menu,
  Text,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import naisysLogo from "@naisys/common/assets/naisys-logo.webp";
import { IconApi, IconLogout, IconUser } from "@tabler/icons-react";
import React from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { useSession } from "../contexts/SessionContext";
import { ConnectionStatus } from "./ConnectionStatus";

interface AppHeaderProps {
  burgerOpened: boolean;
  onBurgerClick: () => void;
  onLoginOpen: () => void;
  hasErp: boolean;
}

export const AppHeader: React.FC<AppHeaderProps> = ({
  burgerOpened,
  onBurgerClick,
  onLoginOpen,
  hasErp,
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isAuthenticated, hasPermission, logout } = useSession();

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
    <Group h="100%" px="md" wrap="nowrap" gap="xs">
      {/* Logo / Burger */}
      <Burger
        opened={burgerOpened}
        onClick={onBurgerClick}
        hiddenFrom="sm"
        size="sm"
        style={{ flexShrink: 0 }}
      />
      <Link
        to="/agents"
        style={{
          textDecoration: "none",
          color: "inherit",
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          cursor: "pointer",
          flexShrink: 0,
        }}
      >
        <img
          src={naisysLogo}
          alt="NAISYS"
          style={{ width: "36px", height: "36px" }}
        />
        <Text size="lg" fw={500} visibleFrom="sm">
          NAISYS
        </Text>
      </Link>

      {/* App title */}
      <Group gap={6} visibleFrom="sm" wrap="nowrap" style={{ flexShrink: 0 }}>
        <Text size="sm" fw={700}>
          Supervisor
        </Text>
        {hasErp && (
          <>
            <Text size="sm" c="dimmed">
              |
            </Text>
            <Text
              size="sm"
              c="dimmed"
              style={{ cursor: "pointer" }}
              onClick={() => {
                window.location.href = "/erp/";
              }}
            >
              ERP
            </Text>
          </>
        )}
      </Group>

      {/* Page nav - flexible, clips when space is tight */}
      <Group
        gap="xs"
        visibleFrom="sm"
        wrap="nowrap"
        style={{ flex: 1, minWidth: 0, overflow: "hidden" }}
      >
        <UnstyledButton
          onClick={() => navigate("/agents")}
          px="sm"
          py={4}
          style={(theme) => ({
            borderRadius: theme.radius.sm,
            flexShrink: 0,
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
          onClick={() => navigate("/hosts")}
          px="sm"
          py={4}
          style={(theme) => ({
            borderRadius: theme.radius.sm,
            flexShrink: 0,
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
          onClick={() => navigate("/models")}
          px="sm"
          py={4}
          style={(theme) => ({
            borderRadius: theme.radius.sm,
            flexShrink: 0,
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
            onClick={() => navigate("/variables")}
            px="sm"
            py={4}
            style={(theme) => ({
              borderRadius: theme.radius.sm,
              flexShrink: 0,
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
            onClick={() => navigate("/users")}
            px="sm"
            py={4}
            style={(theme) => ({
              borderRadius: theme.radius.sm,
              flexShrink: 0,
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
            onClick={() => navigate("/admin")}
            px="sm"
            py={4}
            style={(theme) => ({
              borderRadius: theme.radius.sm,
              flexShrink: 0,
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
      </Group>

      {/* Spacer when nav is hidden on mobile */}
      <Box hiddenFrom="sm" style={{ flex: 1 }} />

      {/* Right side */}
      <Tooltip label="API Reference">
        <ActionIcon
          variant="subtle"
          color="gray"
          component="a"
          href="/supervisor/api-reference/"
          style={{ flexShrink: 0 }}
        >
          <IconApi size="1.2rem" />
        </ActionIcon>
      </Tooltip>
      <ConnectionStatus />
      {isAuthenticated ? (
        <Menu position="bottom-end" withArrow>
          <Menu.Target>
            <Button
              variant="subtle"
              size="xs"
              color="gray"
              style={{ flexShrink: 0 }}
            >
              {user?.username}
            </Button>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item
              leftSection={<IconUser size="0.9rem" />}
              onClick={() => navigate(`/users/${user?.id}`)}
            >
              My User
            </Menu.Item>
            <Menu.Item
              leftSection={<IconLogout size="0.9rem" />}
              onClick={() => logout()}
            >
              Logout
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      ) : (
        <Button
          size="xs"
          variant="subtle"
          onClick={onLoginOpen}
          style={{ flexShrink: 0 }}
        >
          Login
        </Button>
      )}
    </Group>
  );
};
