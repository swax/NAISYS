import { Button, Container, Stack, Text, Title } from "@mantine/core";

interface RootErrorPageProps {
  error: Error;
}

export const RootErrorPage: React.FC<RootErrorPageProps> = ({ error }) => {
  return (
    <Container size="sm" py="xl">
      <Stack align="center">
        <Title order={1}>Something went wrong</Title>
        <Text size="lg" c="dimmed" ta="center">
          {error.message || "An unexpected error occurred."}
        </Text>
        <Button onClick={() => window.location.reload()}>Reload</Button>
      </Stack>
    </Container>
  );
};
