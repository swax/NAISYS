import { Button, Group, Modal, Stack, TextInput } from "@mantine/core";
import { useForm } from "@mantine/form";
import { useState } from "react";
import { LoginRequestSchema } from "@naisys-erp/shared";
import { showErrorNotification } from "../lib/api";
import { useAuth } from "../lib/AuthContext";
import { zodResolver } from "../lib/zod-resolver";

interface Props {
  opened: boolean;
  onClose: () => void;
}

export const LoginModal: React.FC<Props> = ({ opened, onClose }) => {
  const { login } = useAuth();
  const [submitting, setSubmitting] = useState(false);

  const form = useForm({
    initialValues: {
      username: "",
      password: "",
    },
    validate: zodResolver(LoginRequestSchema),
  });

  const handleClose = () => {
    form.reset();
    onClose();
  };

  const handleSubmit = async (values: typeof form.values) => {
    setSubmitting(true);
    try {
      await login(values.username, values.password);
      form.reset();
      onClose();
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal opened={opened} onClose={handleClose} title="Login">
      <form onSubmit={form.onSubmit(handleSubmit)}>
        <Stack gap="md">
          <TextInput
            label="Username"
            {...form.getInputProps("username")}
            data-autofocus
          />
          <TextInput
            label="Password"
            type="password"
            {...form.getInputProps("password")}
          />
          <Group justify="flex-end">
            <Button variant="subtle" onClick={handleClose}>
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
