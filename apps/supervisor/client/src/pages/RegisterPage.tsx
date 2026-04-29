import {
  Alert,
  Anchor,
  Button,
  Center,
  Loader,
  PasswordInput,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import naisysLogo from "@naisys/common/assets/naisys-logo.webp";
import { browserSupportsWebAuthn } from "@simplewebauthn/browser";
import React from "react";
import {
  useNavigate,
  useOutletContext,
  useSearchParams,
} from "react-router-dom";

import type { AppOutletContext } from "../App";
import { useSession } from "../contexts/SessionContext";
import {
  lookupRegistrationToken,
  passkeyRegister,
  passwordRegister,
} from "../lib/apiAuth";

type Phase = "loading" | "ready" | "registering" | "done" | "error";

export const RegisterPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const navigate = useNavigate();
  const { allowPasswordLogin } = useOutletContext<AppOutletContext>();
  const { setAuthenticatedUser } = useSession();

  const [phase, setPhase] = React.useState<Phase>("loading");
  const [mode, setMode] = React.useState<"passkey" | "password">("passkey");
  const [username, setUsername] = React.useState("");
  const [deviceLabel, setDeviceLabel] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [errorMessage, setErrorMessage] = React.useState("");
  const supported = browserSupportsWebAuthn();

  React.useEffect(() => {
    if (!token) {
      setPhase("error");
      setErrorMessage(
        "This page expects a one-time registration token in the URL.",
      );
      return;
    }
    void (async () => {
      try {
        const { username: u } = await lookupRegistrationToken(token);
        setUsername(u);
        setPhase("ready");
      } catch (err) {
        setErrorMessage(
          err instanceof Error ? err.message : "Token validation failed",
        );
        setPhase("error");
      }
    })();
  }, [token]);

  const finishRegistration = (
    user?: Parameters<typeof setAuthenticatedUser>[0],
  ) => {
    if (user) {
      setAuthenticatedUser(user);
    }
    setPhase("done");
    window.setTimeout(() => {
      void navigate("/", { replace: true });
    }, 800);
  };

  const handleRegister = async () => {
    if (!token) return;
    setPhase("registering");
    setErrorMessage("");
    try {
      const result = await passkeyRegister({
        token,
        deviceLabel: deviceLabel.trim() || undefined,
      });
      finishRegistration(result.user);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Passkey registration failed",
      );
      setPhase("ready");
    }
  };

  const handlePasswordRegister = async () => {
    if (!token) return;
    if (password !== confirmPassword) {
      setErrorMessage("Passwords do not match");
      return;
    }
    setPhase("registering");
    setErrorMessage("");
    try {
      const result = await passwordRegister({ token, password });
      finishRegistration(result.user);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Password setup failed",
      );
      setPhase("ready");
    }
  };

  return (
    <Center style={{ minHeight: "100vh" }}>
      <Stack align="center" gap="lg" w={380}>
        <img
          src={naisysLogo}
          alt="NAISYS"
          style={{ width: "64px", height: "64px" }}
        />
        <Text size="xl" fw={600}>
          {allowPasswordLogin ? "Set Up Credential" : "Register Passkey"}
        </Text>

        {phase === "loading" && <Loader />}

        {phase === "error" && (
          <Alert color="red" variant="light" w="100%">
            {errorMessage}
          </Alert>
        )}

        {(phase === "ready" || phase === "registering") &&
          (mode === "passkey" ? (
            <form
              style={{ width: "100%" }}
              onSubmit={(e) => {
                e.preventDefault();
                if (supported && phase === "ready") void handleRegister();
              }}
            >
              <Stack gap="md" w="100%">
                {!supported && (
                  <Alert color="yellow" variant="light">
                    This browser doesn't support passkeys. Use a modern Chrome,
                    Safari, Firefox, or Edge build.
                  </Alert>
                )}
                <Text size="sm" ta="center" c="dimmed">
                  Register a passkey for <b>{username}</b>. Your device's
                  biometric prompt will appear.
                </Text>
                <TextInput
                  label="Device label"
                  placeholder="e.g. MacBook, iPhone"
                  value={deviceLabel}
                  onChange={(e) => setDeviceLabel(e.currentTarget.value)}
                  disabled={phase === "registering"}
                />
                {errorMessage && (
                  <Alert color="red" variant="light">
                    {errorMessage}
                  </Alert>
                )}
                <Button
                  type="submit"
                  fullWidth
                  size="md"
                  loading={phase === "registering"}
                  disabled={!supported}
                >
                  Register passkey
                </Button>
                {allowPasswordLogin && (
                  <Text size="xs" c="dimmed" ta="center">
                    <Anchor
                      component="button"
                      type="button"
                      size="xs"
                      onClick={() => {
                        setMode("password");
                        setErrorMessage("");
                      }}
                    >
                      Set password instead
                    </Anchor>
                  </Text>
                )}
              </Stack>
            </form>
          ) : (
            <form
              style={{ width: "100%" }}
              onSubmit={(e) => {
                e.preventDefault();
                if (phase === "ready") void handlePasswordRegister();
              }}
            >
              <Stack gap="md" w="100%">
                <Text size="sm" ta="center" c="dimmed">
                  Set a password for <b>{username}</b>.
                </Text>
                <PasswordInput
                  label="Password"
                  value={password}
                  onChange={(e) => setPassword(e.currentTarget.value)}
                  disabled={phase === "registering"}
                  autoFocus
                />
                <PasswordInput
                  label="Confirm password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.currentTarget.value)}
                  disabled={phase === "registering"}
                />
                {errorMessage && (
                  <Alert color="red" variant="light">
                    {errorMessage}
                  </Alert>
                )}
                <Button
                  type="submit"
                  fullWidth
                  size="md"
                  loading={phase === "registering"}
                  disabled={password.length < 8 || !confirmPassword}
                >
                  Set password
                </Button>
                <Text size="xs" c="dimmed" ta="center">
                  <Anchor
                    component="button"
                    type="button"
                    size="xs"
                    onClick={() => {
                      setMode("passkey");
                      setErrorMessage("");
                    }}
                  >
                    Use passkey instead
                  </Anchor>
                </Text>
              </Stack>
            </form>
          ))}

        {phase === "done" && (
          <Alert color="green" variant="light" w="100%">
            Credential set. Signing you in…
          </Alert>
        )}
      </Stack>
    </Center>
  );
};
