import { MantineProvider, Container, Title, Text } from "@mantine/core";
import "@mantine/core/styles.css";

const App: React.FC = () => {
  return (
    <MantineProvider defaultColorScheme="dark">
      <Container size="sm" py="xl">
        <Title order={1}>NAISYS ERP</Title>
        <Text mt="md">Hello World</Text>
      </Container>
    </MantineProvider>
  );
};

export default App;
