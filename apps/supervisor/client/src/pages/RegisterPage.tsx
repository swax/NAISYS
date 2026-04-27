import {
  Alert,
  Button,
  Center,
  Loader,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import naisysLogo from "@naisys/common/assets/naisys-logo.webp";
import { browserSupportsWebAuthn } from "@simplewebauthn/browser";
import React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { useSession } from "../contexts/SessionContext";
import { lookupRegistrationToken, passkeyRegister } from "../lib/apiAuth";

type Phase = "loading" | "ready" | "registering" | "done" | "error";

export const RegisterPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const navigate = useNavigate();
  const { setAuthenticatedUser } = useSession();

  const [phase, setPhase] = React.useState<Phase>("loading");
  const [username, setUsername] = React.useState("");
  const [deviceLabel, setDeviceLabel] = React.useState("");
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

  const handleRegister = async () => {
    if (!token) return;
    setPhase("registering");
    setErrorMessage("");
    try {
      const result = await passkeyRegister({
        token,
        deviceLabel: deviceLabel.trim() || undefined,
      });
      if (result.user) {
        setAuthenticatedUser(result.user);
      }
      setPhase("done");
      // Brief pause so user sees the confirmation, then route into the app.
      window.setTimeout(() => {
        void navigate("/", { replace: true });
      }, 800);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Passkey registration failed",
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
          Register Passkey
        </Text>

        {phase === "loading" && <Loader />}

        {phase === "error" && (
          <Alert color="red" variant="light" w="100%">
            {errorMessage}
          </Alert>
        )}

        {(phase === "ready" || phase === "registering") && (
          <Stack gap="md" w="100%">
            {!supported && (
              <Alert color="yellow" variant="light">
                This browser doesn't support passkeys. Use a modern Chrome,
                Safari, Firefox, or Edge build.
              </Alert>
            )}
            <Text size="sm" ta="center" c="dimmed">
              Register a passkey for <b>{username}</b>. Your device's biometric
              prompt will appear.
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
              fullWidth
              size="md"
              onClick={handleRegister}
              loading={phase === "registering"}
              disabled={!supported}
            >
              Register passkey
            </Button>
          </Stack>
        )}

        {phase === "done" && (
          <Alert color="green" variant="light" w="100%">
            Passkey registered. Signing you in…
          </Alert>
        )}
      </Stack>
    </Center>
  );
};
