import { Button, Container, Group, Stack, Text, Title } from "@mantine/core";
import { useNavigate } from "react-router";

interface RouteErrorPageProps {
  error: Error;
}

export const RouteErrorPage: React.FC<RouteErrorPageProps> = ({ error }) => {
  const navigate = useNavigate();

  return (
    <Container size="sm" py="xl">
      <Stack align="center">
        <Title order={2}>Something went wrong</Title>
        <Text c="dimmed" ta="center">
          {error.message || "An unexpected error occurred on this page."}
        </Text>
        <Group>
          <Button variant="default" onClick={() => navigate(-1)}>
            Go back
          </Button>
          <Button onClick={() => window.location.reload()}>Reload</Button>
        </Group>
      </Stack>
    </Container>
  );
};
