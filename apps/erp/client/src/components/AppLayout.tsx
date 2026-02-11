import {
  AppShell,
  Burger,
  Button,
  Group,
  Text,
  UnstyledButton,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useLocation, useNavigate, Outlet } from "react-router";
import { useAuth } from "../lib/AuthContext";
import { LoginModal } from "./LoginModal";

const navLinks = [
  { label: "Planning", path: "/planning/orders" },
  { label: "Execution", path: "/execution/orders" },
  { label: "API Reference", path: "/erp/api-reference/", external: true },
  { label: "Supervisor", path: "/supervisor", external: true },
];

export const AppLayout: React.FC = () => {
  const [opened, { toggle, close }] = useDisclosure();
  const [loginOpen, { open: openLogin, close: closeLogin }] = useDisclosure();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();

  const isActive = (path: string) => location.pathname.startsWith(path);

  const handleNav = (path: string, external?: boolean) => {
    if (external) {
      window.location.href = path;
    } else {
      navigate(path);
    }
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
            <Text fw={700} size="lg">
              NAISYS ERP
            </Text>
            <Group ml="xl" gap="xs" visibleFrom="sm">
              {navLinks.map((link) => (
                <UnstyledButton
                  key={link.path}
                  onClick={() => handleNav(link.path, link.external)}
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
          <Group gap="sm">
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
        {navLinks.map((link) => (
          <UnstyledButton
            key={link.path}
            onClick={() => handleNav(link.path, link.external)}
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
