import React from "react";
import {
  Modal,
  Stack,
  Alert,
  Text,
  TextInput,
  Group,
  Button,
} from "@mantine/core";
import { useSession } from "../contexts/SessionContext";
import { submitAccessKey, logout } from "../lib/apiClient";

interface AccessDialogProps {
  opened: boolean;
  onClose: () => void;
}

export const AccessDialog: React.FC<AccessDialogProps> = ({
  opened,
  onClose,
}) => {
  const { isAuthenticated, setIsAuthenticated } = useSession();
  const [accessKey, setAccessKey] = React.useState("");
  const [isLoading, setIsLoading] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState("");

  const handleSubmitAccessKey = async () => {
    if (!accessKey.trim()) {
      setErrorMessage("Please enter an access key");
      return;
    }

    setIsLoading(true);
    setErrorMessage("");

    try {
      const result = await submitAccessKey(accessKey);

      if (result.success) {
        setIsAuthenticated(true);
        onClose();
        setAccessKey("");
        setErrorMessage("");
      } else {
        setErrorMessage(result.message || "Access key incorrect");
      }
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
      setIsAuthenticated(false);
      onClose();
    } catch (error) {
      console.error("Logout failed:", error);
      // Still clear authentication on client side even if server call fails
      setIsAuthenticated(false);
      onClose();
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    onClose();
    setErrorMessage("");
    setAccessKey("");
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
    <Modal
      opened={opened}
      onClose={handleClose}
      title="Enter Access Key"
      centered
    >
      <Stack gap="md">
        {errorMessage && (
          <Alert color="red" variant="light">
            {errorMessage}
          </Alert>
        )}
        <TextInput
          label="Access Key"
          placeholder="Enter your access key"
          value={accessKey}
          onChange={(event) => setAccessKey(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              handleSubmitAccessKey();
            }
          }}
          data-autofocus
          disabled={isLoading}
        />
        <Group justify="flex-end" gap="xs">
          <Button variant="light" onClick={handleClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmitAccessKey}
            loading={isLoading}
            disabled={!accessKey.trim()}
          >
            Submit
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
};
