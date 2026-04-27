import {
  ActionIcon,
  Box,
  Button,
  Group,
  Menu,
  Text,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import naisysLogo from "@naisys/common/assets/naisys-logo.webp";
import { browserSupportsWebAuthn } from "@simplewebauthn/browser";
import {
  IconApi,
  IconLogout,
  IconRefresh,
  IconUser,
} from "@tabler/icons-react";
import React, { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { useSession } from "../contexts/SessionContext";
import { ConnectionStatus } from "./ConnectionStatus";
import { navTabs } from "./navTabs";

interface AppHeaderProps {
  onBurgerClick: () => void;
  hasErp: boolean;
}

export const AppHeader: React.FC<AppHeaderProps> = ({
  onBurgerClick,
  hasErp,
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isAuthenticated, hasPermission, logout, loginWithPasskey } =
    useSession();
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const passkeySupported = browserSupportsWebAuthn();

  const handleLogin = async () => {
    setIsLoggingIn(true);
    try {
      await loginWithPasskey();
    } catch (error) {
      notifications.show({
        title: "Sign-in failed",
        message: error instanceof Error ? error.message : "Sign-in failed",
        color: "red",
      });
    } finally {
      setIsLoggingIn(false);
    }
  };

  const [isPwa, setIsPwa] = useState(
    () =>
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true,
  );

  useEffect(() => {
    const mql = window.matchMedia("(display-mode: standalone)");
    const handler = (e: MediaQueryListEvent) => setIsPwa(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  const visibleTabs = navTabs.filter(
    (tab) => !tab.permission || hasPermission(tab.permission),
  );

  const activeTab = visibleTabs.find((tab) =>
    location.pathname.startsWith(tab.path),
  );
  const currentTabName = activeTab?.label ?? "Agents";

  return (
    <Group h="100%" px="md" wrap="nowrap" gap="xs">
      {/* Logo (acts as burger on mobile) */}
      <UnstyledButton
        onClick={onBurgerClick}
        hiddenFrom="sm"
        style={{ flexShrink: 0, display: "flex", alignItems: "center" }}
      >
        <img
          src={naisysLogo}
          alt="NAISYS"
          style={{ width: "36px", height: "36px" }}
        />
      </UnstyledButton>
      <Box visibleFrom="sm" style={{ flexShrink: 0 }}>
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
          <Text size="lg" fw={500}>
            NAISYS
          </Text>
        </Link>
      </Box>

      {/* Current tab label (mobile only) */}
      <UnstyledButton
        hiddenFrom="sm"
        onClick={onBurgerClick}
        style={{ flexShrink: 0 }}
      >
        <Text size="sm" fw={600}>
          NAISYS / {currentTabName}
        </Text>
      </UnstyledButton>

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
              component="a"
              href="/erp/"
              style={{ cursor: "pointer", textDecoration: "none" }}
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
        {visibleTabs.map((tab) => {
          const isActive = activeTab === tab;
          return (
            <UnstyledButton
              key={tab.path}
              component={Link}
              to={tab.path}
              px="sm"
              py={4}
              style={(theme) => ({
                borderRadius: theme.radius.sm,
                flexShrink: 0,
                backgroundColor: isActive
                  ? "var(--mantine-color-dark-5)"
                  : undefined,
              })}
            >
              <Text
                size="sm"
                fw={isActive ? 600 : 400}
                c={!isActive ? "dimmed" : undefined}
              >
                {tab.label}
              </Text>
            </UnstyledButton>
          );
        })}
      </Group>

      {/* Spacer when nav is hidden on mobile */}
      <Box hiddenFrom="sm" style={{ flex: 1 }} />

      {/* Right side */}
      {isPwa && (
        <Tooltip label="Refresh">
          <ActionIcon
            variant="subtle"
            color="gray"
            onClick={() => window.location.reload()}
            style={{ flexShrink: 0 }}
          >
            <IconRefresh size="1.2rem" />
          </ActionIcon>
        </Tooltip>
      )}
      <Tooltip label="API Reference">
        <ActionIcon
          variant="subtle"
          color="gray"
          component="a"
          href="/supervisor/api-reference/"
          visibleFrom="sm"
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
              onClick={() => navigate(`/users/${user?.username}`)}
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
        <Tooltip
          label="This browser doesn't support passkeys"
          disabled={passkeySupported}
        >
          <Button
            size="xs"
            variant="subtle"
            onClick={handleLogin}
            loading={isLoggingIn}
            disabled={!passkeySupported}
            style={{ flexShrink: 0 }}
          >
            Sign in with passkey
          </Button>
        </Tooltip>
      )}
    </Group>
  );
};
