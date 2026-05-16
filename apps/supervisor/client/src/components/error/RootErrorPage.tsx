import { Container, Text, Title } from "@mantine/core";
import { isRouteErrorResponse, useRouteError } from "react-router-dom";

export const RootErrorPage: React.FC = () => {
  const error = useRouteError();

  let title = "Something went wrong";
  let message = "An unexpected error occurred.";

  if (isRouteErrorResponse(error)) {
    title = `${error.status}`;
    message = error.statusText || message;
  } else if (error instanceof Error) {
    message = error.message;
  }

  return (
    <Container size="sm" py="xl" style={{ textAlign: "center" }}>
      <Title order={1} mb="md">
        {title}
      </Title>
      <Text size="lg" c="dimmed" mb="xl">
        {message}
      </Text>
    </Container>
  );
};
