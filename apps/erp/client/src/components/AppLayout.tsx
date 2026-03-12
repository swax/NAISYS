import {
  ActionIcon,
  AppShell,
  Burger,
  Button,
  Group,
  Text,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import naisysLogo from "@naisys/common/assets/naisys-logo.webp";
import { IconApi } from "@tabler/icons-react";
import { Link, Outlet, useLocation } from "react-router";

import { useAuth } from "../lib/AuthContext";
import { LoginModal } from "./LoginModal";

const navLinks = [
  { label: "Orders", path: "/orders" },
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
  const location = useLocation();
  const { user, logout } = useAuth();

  const isActive = (path: string) => location.pathname.startsWith(path);

  const handleLogout = async () => {
    await logout();
    window.location.reload();
  };

  return (
    <AppShell
      header={{ height: 50 }}
      navbar={{
        width: 250,
        breakpoint: "sm",
        collapsed: { desktop: true, mobile: !opened },
      }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group>
            <Burger
              opened={opened}
              onClick={toggle}
              hiddenFrom="sm"
              size="sm"
            />
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
              <Text size="lg" fw={500} visibleFrom="sm">
                NAISYS
              </Text>
            </Link>
            <Group gap={6} visibleFrom="sm">
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
            <Group gap="xs" visibleFrom="sm">
              {navLinks.map((link) => (
                <UnstyledButton
                  key={link.path}
                  component={Link}
                  to={link.path}
                  px="sm"
                  py={4}
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
            </Group>
          </Group>
          <Group gap="xs">
            <Tooltip label="API Reference">
              <ActionIcon
                variant="subtle"
                color="gray"
                component="a"
                href="/erp/api-reference/"
              >
                <IconApi size="1.2rem" />
              </ActionIcon>
            </Tooltip>
            {user ? (
              <>
                <Text size="sm">{user.username}</Text>
                <Button size="xs" variant="subtle" onClick={handleLogout}>
                  Logout
                </Button>
              </>
            ) : (
              <Button size="xs" variant="subtle" onClick={openLogin}>
                Login
              </Button>
            )}
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="md">
        {supervisorAuth && (
          <UnstyledButton
            component="a"
            href="/supervisor/"
            p="sm"
            mb={4}
            style={(theme) => ({
              borderRadius: theme.radius.sm,
              textDecoration: "none",
              color: "inherit",
            })}
          >
            <Text size="sm" c="dimmed">
              Supervisor
            </Text>
          </UnstyledButton>
        )}
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
        <Outlet context={{ supervisorAuth }} />
      </AppShell.Main>

      <LoginModal opened={loginOpen} onClose={closeLogin} />
    </AppShell>
  );
};
