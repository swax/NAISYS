import { Container, Text, Title } from "@mantine/core";

export const NotFoundPage: React.FC = () => {
  return (
    <Container size="sm" py="xl" style={{ textAlign: "center" }}>
      <Title order={1} mb="md">
        404
      </Title>
      <Text size="lg" c="dimmed" mb="xl">
        Page not found.
      </Text>
    </Container>
  );
};
