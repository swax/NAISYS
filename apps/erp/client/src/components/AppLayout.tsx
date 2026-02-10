import { AppShell, Burger, Group, Text, UnstyledButton } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useLocation, useNavigate, Outlet } from "react-router";

const navLinks = [
  { label: "Planning", path: "/planning/orders" },
  { label: "Execution", path: "/execution/orders" },
  { label: "API Reference", path: "/api-reference" },
  { label: "Supervisor", path: "/supervisor" },
];

export const AppLayout: React.FC = () => {
  const [opened, { toggle, close }] = useDisclosure();
  const navigate = useNavigate();
  const location = useLocation();

  const isActive = (path: string) => location.pathname.startsWith(path);

  const handleNav = (path: string) => {
    navigate(path);
    close();
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
          <Text size="sm" c="dimmed">
            User
          </Text>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="md">
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
    </AppShell>
  );
};
