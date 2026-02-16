import { Alert, Button, Center, Stack, Text, TextInput } from "@mantine/core";
import React from "react";
import { useSession } from "../contexts/SessionContext";
import naisysLogo from "@naisys/common/assets/naisys-logo.webp";

export const LoginPage: React.FC = () => {
  const { login } = useSession();
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [isLoading, setIsLoading] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState("");

  const handleLogin = async () => {
    if (!username.trim() || !password.trim()) {
      setErrorMessage("Please enter both username and password");
      return;
    }

    setIsLoading(true);
    setErrorMessage("");

    try {
      await login(username, password);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "An error occurred",
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter") {
      handleLogin();
    }
  };

  return (
    <Center style={{ minHeight: "100vh" }}>
      <Stack align="center" gap="lg" w={320}>
        <img
          src={naisysLogo}
          alt="NAISYS"
          style={{ width: "64px", height: "64px" }}
        />
        <Text size="xl" fw={600}>
          NAISYS Supervisor
        </Text>
        <Stack gap="md" w="100%">
          {errorMessage && (
            <Alert color="red" variant="light">
              {errorMessage}
            </Alert>
          )}
          <TextInput
            label="Username"
            placeholder="Enter your username"
            value={username}
            onChange={(event) => setUsername(event.currentTarget.value)}
            onKeyDown={handleKeyDown}
            data-autofocus
            disabled={isLoading}
          />
          <TextInput
            label="Password"
            type="password"
            placeholder="Enter your password"
            value={password}
            onChange={(event) => setPassword(event.currentTarget.value)}
            onKeyDown={handleKeyDown}
            disabled={isLoading}
          />
          <Button
            fullWidth
            onClick={handleLogin}
            loading={isLoading}
            disabled={!username.trim() || !password.trim()}
          >
            Login
          </Button>
        </Stack>
      </Stack>
    </Center>
  );
};
