import { Button, Container, Group, Stack, Text, Title } from "@mantine/core";
import {
  isRouteErrorResponse,
  useNavigate,
  useRouteError,
} from "react-router-dom";

export const RouteErrorPage: React.FC = () => {
  const error = useRouteError();
  const navigate = useNavigate();

  let title = "Something went wrong";
  let message = "An unexpected error occurred on this page.";

  if (isRouteErrorResponse(error)) {
    title = `${error.status}`;
    message = error.statusText || message;
  } else if (error instanceof Error) {
    message = error.message;
  }

  return (
    <Container size="sm" py="xl">
      <Stack align="center">
        <Title order={2}>{title}</Title>
        <Text c="dimmed" ta="center">
          {message}
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
