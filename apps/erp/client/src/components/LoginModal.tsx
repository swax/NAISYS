import { Button, Group, Modal, Stack, TextInput } from "@mantine/core";
import { useState } from "react";
import { showErrorNotification } from "../lib/api";
import { useAuth } from "../lib/AuthContext";

interface Props {
  opened: boolean;
  onClose: () => void;
}

export const LoginModal: React.FC<Props> = ({ opened, onClose }) => {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await login(username, password);
      setUsername("");
      setPassword("");
      onClose();
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title="Login">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit();
        }}
      >
        <Stack gap="md">
          <TextInput
            label="Username"
            value={username}
            onChange={(e) => setUsername(e.currentTarget.value)}
            required
            data-autofocus
          />
          <TextInput
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
            required
          />
          <Group justify="flex-end">
            <Button variant="subtle" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting}>
              Login
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
};
