import {
  ActionIcon,
  Burger,
  Button,
  Group,
  Text,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import naisysLogo from "@naisys/common/assets/naisys-logo.webp";
import { IconApi } from "@tabler/icons-react";
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
    <Group h="100%" px="md" justify="space-between">
      <Group>
        <Burger
          opened={burgerOpened}
          onClick={onBurgerClick}
          hiddenFrom="sm"
          size="sm"
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
        <Group gap={6} visibleFrom="sm">
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
        <Group gap="xs" visibleFrom="sm">
          <UnstyledButton
            onClick={() => navigate("/agents")}
            px="sm"
            py={4}
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
            onClick={() => navigate("/hosts")}
            px="sm"
            py={4}
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
            onClick={() => navigate("/models")}
            px="sm"
            py={4}
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
              onClick={() => navigate("/variables")}
              px="sm"
              py={4}
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
              onClick={() => navigate("/users")}
              px="sm"
              py={4}
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
              onClick={() => navigate("/admin")}
              px="sm"
              py={4}
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
        </Group>
      </Group>
      <Group gap="xs">
        <Tooltip label="API Reference">
          <ActionIcon
            variant="subtle"
            color="gray"
            component="a"
            href="/supervisor/api-reference/"
          >
            <IconApi size="1.2rem" />
          </ActionIcon>
        </Tooltip>
        <ConnectionStatus />
        {isAuthenticated ? (
          <>
            <Text
              size="sm"
              component={Link}
              to={`/users/${user?.id}`}
              c="inherit"
              style={{ textDecoration: "none" }}
            >
              {user?.username}
            </Text>
            <Button size="xs" variant="subtle" onClick={() => logout()}>
              Logout
            </Button>
          </>
        ) : (
          <Button size="xs" variant="subtle" onClick={onLoginOpen}>
            Login
          </Button>
        )}
      </Group>
    </Group>
  );
};
