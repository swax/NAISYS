import {
  ActionIcon,
  Alert,
  AppShell,
  Box,
  Button,
  Divider,
  Group,
  Menu,
  Text,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { NAV_HEADER_ROW_HEIGHT } from "@naisys/common";
import naisysLogo from "@naisys/common/assets/naisys-logo.webp";
import { IconApi, IconEye, IconLogout, IconUser } from "@tabler/icons-react";
import { Link, Outlet, useLocation, useNavigate } from "react-router";

import { useAuth } from "../lib/AuthContext";
import { LoginModal } from "./LoginModal";

const navLinks = [
  { label: "Items", path: "/items" },
  { label: "Orders", path: "/orders" },
  { label: "Dispatch", path: "/dispatch" },
  { label: "Users", path: "/users" },
];

export interface AppOutletContext {
  supervisorAuth: boolean;
}

interface AppLayoutProps {
  supervisorAuth: boolean;
}

export const AppLayout: React.FC<AppLayoutProps> = ({ supervisorAuth }) => {
  const [opened, { toggle, close }] = useDisclosure();
  const [loginOpen, { open: openLogin, close: closeLogin }] = useDisclosure();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();

  const isActive = (path: string) => location.pathname.startsWith(path);
  const currentTabName =
    navLinks.find((link) => isActive(link.path))?.label ?? "Orders";

  const handleLogout = async () => {
    await logout();
    window.location.reload();
  };

  return (
    <AppShell
      header={{ height: NAV_HEADER_ROW_HEIGHT }}
      navbar={{
        width: 250,
        breakpoint: "sm",
        collapsed: { desktop: true, mobile: !opened },
      }}
      padding={0}
    >
      <AppShell.Header>
        <Group h="100%" px="md" wrap="nowrap" gap="xs">
          {/* Logo (acts as burger on mobile) */}
          <UnstyledButton
            onClick={toggle}
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
              to="/orders"
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
            onClick={toggle}
            style={{ flexShrink: 0 }}
          >
            <Text size="sm" fw={600}>
              NAISYS / {currentTabName}
            </Text>
          </UnstyledButton>

          {/* App title */}
          <Group
            gap={6}
            visibleFrom="sm"
            wrap="nowrap"
            style={{ flexShrink: 0 }}
          >
            {supervisorAuth && (
              <>
                <Text
                  size="sm"
                  c="dimmed"
                  component="a"
                  href="/supervisor/"
                  style={{ cursor: "pointer", textDecoration: "none" }}
                >
                  Supervisor
                </Text>
                <Text size="sm" c="dimmed">
                  |
                </Text>
              </>
            )}
            <Text size="sm" fw={700}>
              ERP
            </Text>
          </Group>

          {/* Page nav - flexible, clips when space is tight */}
          <Group
            gap="xs"
            visibleFrom="sm"
            wrap="nowrap"
            style={{ flex: 1, minWidth: 0, overflow: "hidden" }}
          >
            {navLinks.map((link) => (
              <UnstyledButton
                key={link.path}
                component={Link}
                to={link.path}
                px="sm"
                py={4}
                style={(theme) => ({
                  borderRadius: theme.radius.sm,
                  flexShrink: 0,
                  backgroundColor: isActive(link.path)
                    ? "var(--mantine-color-dark-5)"
                    : undefined,
                })}
              >
                <Text
                  size="sm"
                  fw={isActive(link.path) ? 600 : 400}
                  c={isActive(link.path) ? undefined : "dimmed"}
                >
                  {link.label}
                </Text>
              </UnstyledButton>
            ))}
          </Group>

          {/* Spacer when nav is hidden on mobile */}
          <Box hiddenFrom="sm" style={{ flex: 1 }} />

          {/* Right side */}
          <Tooltip label="API Reference">
            <ActionIcon
              variant="subtle"
              color="gray"
              component="a"
              href="/erp/api-reference/"
              visibleFrom="sm"
              style={{ flexShrink: 0 }}
            >
              <IconApi size="1.2rem" />
            </ActionIcon>
          </Tooltip>
          {user ? (
            <Menu position="bottom-end" withArrow>
              <Menu.Target>
                <Button
                  variant="subtle"
                  size="xs"
                  color="gray"
                  style={{ flexShrink: 0 }}
                >
                  {user.username}
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item
                  leftSection={<IconUser size="0.9rem" />}
                  onClick={() => navigate(`/users/${user.username}`)}
                >
                  My User
                </Menu.Item>
                <Menu.Item
                  leftSection={<IconLogout size="0.9rem" />}
                  onClick={handleLogout}
                >
                  Logout
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          ) : (
            <Button
              size="xs"
              variant="subtle"
              onClick={openLogin}
              style={{ flexShrink: 0 }}
            >
              Login
            </Button>
          )}
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="md">
        <Group gap={6} px="sm" py={4}>
          {supervisorAuth && (
            <>
              <Text
                size="sm"
                c="dimmed"
                component="a"
                href="/supervisor/"
                style={{ textDecoration: "none" }}
              >
                Supervisor
              </Text>
              <Text size="sm" c="dimmed">
                |
              </Text>
            </>
          )}
          <Text size="sm" fw={700}>
            ERP
          </Text>
        </Group>
        <Divider mb={4} />
        {navLinks.map((link) => (
          <UnstyledButton
            key={link.path}
            component={Link}
            to={link.path}
            onClick={close}
            p="sm"
            mb={4}
            style={(theme) => ({
              borderRadius: theme.radius.sm,
              backgroundColor: isActive(link.path)
                ? "var(--mantine-color-dark-5)"
                : undefined,
            })}
          >
            <Text
              size="sm"
              fw={isActive(link.path) ? 600 : 400}
              c={isActive(link.path) ? undefined : "dimmed"}
            >
              {link.label}
            </Text>
          </UnstyledButton>
        ))}
      </AppShell.Navbar>

      <AppShell.Main>
        {!user && (
          <Alert
            variant="light"
            color="violet"
            icon={<IconEye size="1rem" />}
            py={4}
            radius={0}
            styles={{
              wrapper: {
                justifyContent: "center" as const,
                alignItems: "center" as const,
              },
              body: { flex: "initial" as const },
            }}
          >
            <Text size="xs">
              Public read-only mode — login for full access
            </Text>
          </Alert>
        )}
        <Outlet context={{ supervisorAuth }} />
      </AppShell.Main>

      <LoginModal opened={loginOpen} onClose={closeLogin} />
    </AppShell>
  );
};
