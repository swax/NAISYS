import {
  Alert,
  Button,
  Group,
  Modal,
  PasswordInput,
  Stack,
  Text,
} from "@mantine/core";
import React from "react";

import { setStepUpPasswordPrompt, verifyOwnPassword } from "../lib/apiAuth";

type Resolver = (password: string | null) => void;

export const StepUpPasswordPromptProvider: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  const [opened, setOpened] = React.useState(false);
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState("");
  const [verifying, setVerifying] = React.useState(false);
  const resolverRef = React.useRef<Resolver | null>(null);

  const resolvePrompt = React.useCallback((value: string | null) => {
    const resolver = resolverRef.current;
    resolverRef.current = null;
    setOpened(false);
    setPassword("");
    setError("");
    setVerifying(false);
    resolver?.(value);
  }, []);

  React.useEffect(() => {
    setStepUpPasswordPrompt(async () => {
      if (resolverRef.current) return null;
      return await new Promise<string | null>((resolve) => {
        resolverRef.current = resolve;
        setPassword("");
        setError("");
        setOpened(true);
      });
    });

    return () => {
      setStepUpPasswordPrompt(null);
      resolverRef.current?.(null);
      resolverRef.current = null;
    };
  }, []);

  const submit = async () => {
    if (!password || verifying) return;
    setVerifying(true);
    setError("");
    try {
      await verifyOwnPassword(password);
      resolvePrompt(password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Incorrect password");
      setVerifying(false);
    }
  };

  return (
    <>
      {children}
      <Modal
        opened={opened}
        onClose={() => resolvePrompt(null)}
        title="Confirm password"
        centered
        closeOnClickOutside={false}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Stack gap="md">
            <Text size="sm" c="dimmed">
              Re-enter your Supervisor password to continue.
            </Text>
            <PasswordInput
              label="Password"
              value={password}
              onChange={(event) => {
                setPassword(event.currentTarget.value);
                if (error) setError("");
              }}
              disabled={verifying}
              autoFocus
              data-autofocus
            />
            {error && (
              <Alert color="red" variant="light">
                {error}
              </Alert>
            )}
            <Group justify="flex-end" gap="xs">
              <Button
                variant="subtle"
                type="button"
                onClick={() => resolvePrompt(null)}
                disabled={verifying}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!password} loading={verifying}>
                Continue
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </>
  );
};
