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
import { Link, Outlet,useLocation, useNavigate } from "react-router";

import { useAuth } from "../lib/AuthContext";
import { LoginModal } from "./LoginModal";

const navLinks = [
  { label: "Planning", path: "/planning/orders" },
  { label: "Execution", path: "/execution/orders" },
];

export const AppLayout: React.FC = () => {
  const [opened, { toggle, close }] = useDisclosure();
  const [loginOpen, { open: openLogin, close: closeLogin }] = useDisclosure();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();

  const isActive = (path: string) => location.pathname.startsWith(path);

  const handleNav = (path: string) => {
    void navigate(path);
    close();
  };

  const handleLogout = async () => {
    await logout();
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
              to="/planning/orders"
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
              <Text
                size="sm"
                c="dimmed"
                style={{ cursor: "pointer" }}
                onClick={() => {
                  window.location.href = "/supervisor/";
                }}
              >
                Supervisor
              </Text>
              <Text size="sm" c="dimmed">
                |
              </Text>
              <Text size="sm" fw={700}>
                ERP
              </Text>
            </Group>
            <Group gap="xs" visibleFrom="sm">
              {navLinks.map((link) => (
                <UnstyledButton
                  key={link.path}
                  onClick={() => handleNav(link.path)}
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
        <UnstyledButton
          onClick={() => {
            window.location.href = "/supervisor/";
          }}
          p="sm"
          mb={4}
          style={(theme) => ({
            borderRadius: theme.radius.sm,
          })}
        >
          <Text size="sm" c="dimmed">
            Supervisor
          </Text>
        </UnstyledButton>
        {navLinks.map((link) => (
          <UnstyledButton
            key={link.path}
            onClick={() => handleNav(link.path)}
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
        <Outlet />
      </AppShell.Main>

      <LoginModal opened={loginOpen} onClose={closeLogin} />
    </AppShell>
  );
};
