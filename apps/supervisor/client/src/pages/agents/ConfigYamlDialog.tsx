import { Alert, Button, Group, Loader, Modal, Stack, Textarea } from "@mantine/core";
import React, { useEffect, useState } from "react";

import { exportAgentConfig, importAgentConfig } from "../../lib/apiAgents";

interface ConfigYamlDialogProps {
  agentId: number;
  mode: "import" | "export";
  opened: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const ConfigYamlDialog: React.FC<ConfigYamlDialogProps> = ({
  agentId,
  mode,
  opened,
  onClose,
  onSuccess,
}) => {
  const [yamlText, setYamlText] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!opened) return;

    if (mode === "export") {
      setLoading(true);
      setError(null);
      exportAgentConfig(agentId)
        .then((result) => {
          setYamlText(result.yaml);
        })
        .catch((err) => {
          setError(
            err instanceof Error
              ? err.message
              : "Failed to export configuration",
          );
        })
        .finally(() => {
          setLoading(false);
        });
    } else {
      setYamlText("");
    }
  }, [opened, mode, agentId]);

  const handleImport = async () => {
    if (!yamlText.trim()) return;

    setIsImporting(true);
    setError(null);

    try {
      const result = await importAgentConfig(agentId, yamlText);

      if (!result.success) {
        setError(result.message || "Failed to import configuration");
        return;
      }

      onSuccess();
      handleClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to import configuration",
      );
    } finally {
      setIsImporting(false);
    }
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(yamlText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleClose = () => {
    setYamlText("");
    setError(null);
    setCopied(false);
    onClose();
  };

  const isExport = mode === "export";

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title={isExport ? "Export Config" : "Import Config"}
      centered
      size="lg"
    >
      <Stack gap="md">
        {loading ? (
          <Stack align="center" p="xl">
            <Loader size="md" />
          </Stack>
        ) : (
          <Textarea
            label="YAML Configuration"
            placeholder={
              isExport ? undefined : "Paste agent configuration YAML here..."
            }
            value={yamlText}
            onChange={
              isExport ? undefined : (e) => setYamlText(e.currentTarget.value)
            }
            readOnly={isExport}
            autosize
            minRows={10}
            maxRows={25}
            styles={{ input: { fontFamily: "monospace" } }}
            disabled={isImporting}
          />
        )}
        {error && (
          <Alert
            color="red"
            title="Error"
            withCloseButton
            onClose={() => setError(null)}
          >
            {error}
          </Alert>
        )}
        <Group justify="flex-end">
          {isExport ? (
            <>
              <Button variant="default" onClick={handleClose}>
                Close
              </Button>
              <Button onClick={handleCopy} disabled={!yamlText || loading}>
                {copied ? "Copied!" : "Copy"}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="default"
                onClick={handleClose}
                disabled={isImporting}
              >
                Cancel
              </Button>
              <Button
                onClick={handleImport}
                loading={isImporting}
                disabled={!yamlText.trim()}
              >
                Import
              </Button>
            </>
          )}
        </Group>
      </Stack>
    </Modal>
  );
};
