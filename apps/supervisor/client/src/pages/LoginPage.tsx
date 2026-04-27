import { Alert, Button, Center, Stack, Text } from "@mantine/core";
import naisysLogo from "@naisys/common/assets/naisys-logo.webp";
import { browserSupportsWebAuthn } from "@simplewebauthn/browser";
import React from "react";

import { useSession } from "../contexts/SessionContext";

export const LoginPage: React.FC = () => {
  const { loginWithPasskey } = useSession();
  const [isLoading, setIsLoading] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState("");
  const supported = browserSupportsWebAuthn();

  const handleLogin = async () => {
    setIsLoading(true);
    setErrorMessage("");
    try {
      await loginWithPasskey();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Sign-in failed",
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Center style={{ minHeight: "100vh" }}>
      <Stack align="center" gap="lg" w={360}>
        <img
          src={naisysLogo}
          alt="NAISYS"
          style={{ width: "64px", height: "64px" }}
        />
        <Text size="xl" fw={600}>
          NAISYS Supervisor
        </Text>
        <Stack gap="md" w="100%">
          {!supported && (
            <Alert color="yellow" variant="light">
              This browser doesn't support passkeys. Use a modern Chrome,
              Safari, Firefox, or Edge build.
            </Alert>
          )}
          {errorMessage && (
            <Alert color="red" variant="light">
              {errorMessage}
            </Alert>
          )}
          <Button
            fullWidth
            size="md"
            onClick={handleLogin}
            loading={isLoading}
            disabled={!supported}
          >
            Sign in with passkey
          </Button>
          <Text size="xs" c="dimmed" ta="center">
            Don't have a passkey yet? Ask an admin for a registration link.
          </Text>
        </Stack>
      </Stack>
    </Center>
  );
};
