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
import { getSettings, saveSettings } from "../lib/apiAuth";

interface SettingsDialogProps {
  opened: boolean;
  onClose: () => void;
}

export const SettingsDialog: React.FC<SettingsDialogProps> = ({
  opened,
  onClose,
}) => {
  const [path, setPath] = React.useState("");
  const [settingsLoading, setSettingsLoading] = React.useState(false);
  const [settingsErrorMessage, setSettingsErrorMessage] = React.useState("");
  const [settingsSuccessMessage, setSettingsSuccessMessage] =
    React.useState("");

  const loadSettings = async () => {
    setSettingsLoading(true);
    setSettingsErrorMessage("");
    try {
      const response = await getSettings();
      if (response.success && response.settings) {
        setPath(response.settings.example || "");
      } else {
        setSettingsErrorMessage(response.message || "Failed to load settings");
      }
    } catch (error) {
      setSettingsErrorMessage("Error loading settings");
    } finally {
      setSettingsLoading(false);
    }
  };

  const handleSaveSettings = async () => {
    setSettingsLoading(true);
    setSettingsErrorMessage("");
    setSettingsSuccessMessage("");

    try {
      const response = await saveSettings({
        settings: { example: path.trim() },
      });

      if (response.success) {
        setSettingsSuccessMessage("Settings saved successfully!");
        setTimeout(() => {
          setSettingsSuccessMessage("");
          onClose();
        }, 1500);
      } else {
        setSettingsErrorMessage(response.message || "Failed to save settings");
      }
    } catch (error) {
      setSettingsErrorMessage("Error saving settings");
    } finally {
      setSettingsLoading(false);
    }
  };

  const handleClose = () => {
    onClose();
    setSettingsErrorMessage("");
    setSettingsSuccessMessage("");
  };

  React.useEffect(() => {
    if (opened) {
      loadSettings();
    }
  }, [opened]);

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title="NAISYS Supervisor Settings"
      size="lg"
      centered
    >
      <Stack gap="md">
        {settingsErrorMessage && (
          <Alert color="red" variant="light">
            {settingsErrorMessage}
          </Alert>
        )}

        {settingsSuccessMessage && (
          <Alert color="green" variant="light">
            {settingsSuccessMessage}
          </Alert>
        )}

        <div>
          <Text size="sm" fw={500} mb="xs">
            NAISYS_FOLDER
          </Text>
          <Text size="xs" c="dimmed" mb="sm">
            Enter the folder path that will be monitored by Supervisor.
          </Text>
          <TextInput
            value={path}
            onChange={(event) => setPath(event.currentTarget.value)}
            placeholder="/path/to/folder"
            disabled={settingsLoading}
          />
        </div>

        <Group justify="flex-end" gap="xs">
          <Button
            variant="light"
            onClick={handleClose}
            disabled={settingsLoading}
          >
            Cancel
          </Button>
          <Button onClick={handleSaveSettings} loading={settingsLoading}>
            Save Settings
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
};
