import {
  Alert,
  Anchor,
  Button,
  Center,
  PasswordInput,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import naisysLogo from "@naisys/common/assets/naisys-logo.webp";
import { browserSupportsWebAuthn } from "@simplewebauthn/browser";
import React from "react";

import { useSession } from "../contexts/SessionContext";

export const LoginPage: React.FC<{ allowPasswordLogin?: boolean }> = ({
  allowPasswordLogin = false,
}) => {
  const { loginWithPasskey, loginWithPassword } = useSession();
  const [isLoading, setIsLoading] = React.useState(false);
  const [passwordLoading, setPasswordLoading] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState("");
  const [showPasswordLogin, setShowPasswordLogin] = React.useState(false);
  const [showLockoutHint, setShowLockoutHint] = React.useState(false);
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const passkeySupported = browserSupportsWebAuthn();

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

  const handlePasswordLogin = async () => {
    setPasswordLoading(true);
    setErrorMessage("");
    try {
      await loginWithPassword(username.trim(), password);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Sign-in failed",
      );
    } finally {
      setPasswordLoading(false);
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
          {!showPasswordLogin && !passkeySupported && (
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
          {!showPasswordLogin && (
            <Button
              fullWidth
              size="md"
              onClick={handleLogin}
              loading={isLoading}
              disabled={!passkeySupported}
            >
              Sign in with passkey
            </Button>
          )}
          {allowPasswordLogin && (
            <>
              {!showPasswordLogin ? (
                <Text size="xs" c="dimmed" ta="center">
                  <Anchor
                    component="button"
                    size="xs"
                    onClick={() => {
                      setErrorMessage("");
                      setShowPasswordLogin(true);
                    }}
                  >
                    Use password instead
                  </Anchor>
                </Text>
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (username.trim() && password) {
                      void handlePasswordLogin();
                    }
                  }}
                >
                  <Stack gap="xs">
                    <TextInput
                      label="Username"
                      value={username}
                      onChange={(e) => setUsername(e.currentTarget.value)}
                      disabled={passwordLoading}
                      autoFocus
                    />
                    <PasswordInput
                      label="Password"
                      value={password}
                      onChange={(e) => setPassword(e.currentTarget.value)}
                      disabled={passwordLoading}
                    />
                    <Button
                      type="submit"
                      fullWidth
                      variant="light"
                      loading={passwordLoading}
                      disabled={!username.trim() || !password}
                    >
                      Sign in with password
                    </Button>
                    <Text size="xs" c="dimmed" ta="center">
                      <Anchor
                        component="button"
                        type="button"
                        size="xs"
                        onClick={() => {
                          setErrorMessage("");
                          setShowPasswordLogin(false);
                        }}
                      >
                        Use passkey instead
                      </Anchor>
                    </Text>
                  </Stack>
                </form>
              )}
            </>
          )}
          <Text size="xs" c="dimmed" ta="center">
            Don't have an account yet? Ask an admin for a registration link.
          </Text>
          <Text size="xs" c="dimmed" ta="center">
            {showLockoutHint ? (
              <>
                If everyone is locked out, restart NAISYS with --setup.{" "}
                <Anchor
                  component="button"
                  type="button"
                  size="xs"
                  onClick={() => setShowLockoutHint(false)}
                >
                  Hide
                </Anchor>
              </>
            ) : (
              <Anchor
                component="button"
                type="button"
                size="xs"
                onClick={() => setShowLockoutHint(true)}
              >
                Trouble signing in?
              </Anchor>
            )}
          </Text>
        </Stack>
      </Stack>
    </Center>
  );
};
