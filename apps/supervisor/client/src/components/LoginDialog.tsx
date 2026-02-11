import {
  Alert,
  Button,
  Group,
  Modal,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import React from "react";
import { useSession } from "../contexts/SessionContext";

interface LoginDialogProps {
  opened: boolean;
  onClose: () => void;
}

export const LoginDialog: React.FC<LoginDialogProps> = ({
  opened,
  onClose,
}) => {
  const { isAuthenticated, login, logout } = useSession();
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
      onClose();
      setUsername("");
      setPassword("");
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "An error occurred",
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = async () => {
    setIsLoading(true);
    try {
      await logout();
      onClose();
    } catch (error) {
      console.error("Logout failed:", error);
      onClose();
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    onClose();
    setErrorMessage("");
    setUsername("");
    setPassword("");
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter") {
      handleLogin();
    }
  };

  if (isAuthenticated) {
    return (
      <Modal
        opened={opened}
        onClose={handleClose}
        title="Confirm Logout"
        centered
      >
        <Stack gap="md">
          <Text>
            Are you sure you want to logout? This will end your current session.
          </Text>
          <Group justify="flex-end" gap="xs">
            <Button variant="light" onClick={handleClose} disabled={isLoading}>
              Cancel
            </Button>
            <Button color="red" onClick={handleLogout} loading={isLoading}>
              Logout
            </Button>
          </Group>
        </Stack>
      </Modal>
    );
  }

  return (
    <Modal opened={opened} onClose={handleClose} title="Login" centered>
      <Stack gap="md">
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
        <Group justify="flex-end" gap="xs">
          <Button variant="light" onClick={handleClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            onClick={handleLogin}
            loading={isLoading}
            disabled={!username.trim() || !password.trim()}
          >
            Login
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
};
