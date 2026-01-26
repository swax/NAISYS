import {
  ActionIcon,
  Box,
  Button,
  Flex,
  Group,
  Image,
  Modal,
  Paper,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import { Dropzone } from "@mantine/dropzone";
import { IconFile, IconPaperclip, IconX } from "@tabler/icons-react";
import React, { useEffect, useState } from "react";
import { Agent } from "../../lib/apiClient";

interface FileAttachment {
  file: File;
  name: string;
  previewUrl?: string;
}

interface NewMessageModalProps {
  opened: boolean;
  onClose: () => void;
  agents: Agent[];
  currentAgentName: string;
  onSend: (
    sender: string,
    recipient: string,
    subject: string,
    body: string,
    attachments: FileAttachment[],
  ) => Promise<void>;
  initialRecipient?: string;
  initialSubject?: string;
  initialBody?: string;
}

export const NewMessageModal: React.FC<NewMessageModalProps> = ({
  opened,
  onClose,
  agents,
  currentAgentName,
  onSend,
  initialRecipient,
  initialSubject,
  initialBody,
}) => {
  const [sender, setSender] = useState<string>(currentAgentName);
  const [recipient, setRecipient] = useState<string>("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [expandedImageIndex, setExpandedImageIndex] = useState<number | null>(
    null,
  );
  const bodyTextareaRef = React.useRef<HTMLTextAreaElement>(null);

  // Update sender when currentAgentName changes
  useEffect(() => {
    setSender(currentAgentName);
  }, [currentAgentName]);

  // Set initial values when modal opens with reply data
  useEffect(() => {
    if (opened && initialRecipient) {
      setRecipient(initialRecipient);
    }
    if (opened && initialSubject) {
      setSubject(initialSubject);
    }
    if (opened && initialBody) {
      setBody(initialBody);
      // Focus the textarea and position cursor at the beginning
      setTimeout(() => {
        if (bodyTextareaRef.current) {
          bodyTextareaRef.current.focus();
          bodyTextareaRef.current.setSelectionRange(0, 0);
        }
      }, 0);
    }
  }, [opened, initialRecipient, initialSubject, initialBody]);

  // Add paste event listener for images
  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      if (!opened || isLoading) return;

      const items = event.clipboardData?.items;
      if (!items) return;

      const files: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            files.push(file);
          }
        }
      }

      if (files.length > 0) {
        event.preventDefault();
        handleFilesAdd(files);
      }
    };

    if (opened) {
      document.addEventListener("paste", handlePaste);
    }

    return () => {
      document.removeEventListener("paste", handlePaste);
    };
  }, [opened, isLoading]);

  // Create options for all agents (including current for sender selection)
  const allAgentOptions = agents.map((agent) => ({
    value: agent.name,
    label: agent.title ? `${agent.name} (${agent.title})` : agent.name,
  }));

  // Filter out the current sender from the recipients list
  const availableRecipients = allAgentOptions.filter(
    (agent) => agent.value !== sender,
  );

  const handleFilesAdd = async (files: File[]) => {
    const newAttachments: FileAttachment[] = [];

    for (const file of files) {
      const attachment: FileAttachment = {
        file,
        name: file.name,
      };

      if (file.type.startsWith("image/")) {
        attachment.previewUrl = URL.createObjectURL(file);
      }

      newAttachments.push(attachment);
    }

    setAttachments((prev) => [...prev, ...newAttachments]);
  };

  const handleFileRemove = (index: number) => {
    setAttachments((prev) => {
      const updated = [...prev];
      const removed = updated.splice(index, 1)[0];
      if (removed.previewUrl) {
        URL.revokeObjectURL(removed.previewUrl);
      }
      return updated;
    });
  };

  const handleFileNameChange = (index: number, newName: string) => {
    setAttachments((prev) =>
      prev.map((attachment, i) => {
        if (i === index) {
          const lastDotIndex = attachment.name.lastIndexOf(".");
          const extension =
            lastDotIndex > 0 ? attachment.name.substring(lastDotIndex) : "";
          return { ...attachment, name: newName + extension };
        }
        return attachment;
      }),
    );
  };

  const getFileNameWithoutExtension = (filename: string) => {
    const lastDotIndex = filename.lastIndexOf(".");
    return lastDotIndex > 0 ? filename.substring(0, lastDotIndex) : filename;
  };

  const handleSend = async () => {
    if (!recipient || !subject.trim() || !body.trim()) {
      return;
    }

    setIsLoading(true);
    try {
      // Create new File objects with updated names
      const attachmentsWithUpdatedNames = attachments.map((attachment) => ({
        ...attachment,
        file: new File([attachment.file], attachment.name, {
          type: attachment.file.type,
        }),
      }));

      await onSend(
        sender,
        recipient,
        subject,
        body,
        attachmentsWithUpdatedNames,
      );
      setSender(currentAgentName);
      setRecipient("");
      setSubject("");
      setBody("");
      attachments.forEach((attachment) => {
        if (attachment.previewUrl) {
          URL.revokeObjectURL(attachment.previewUrl);
        }
      });
      setAttachments([]);
      setExpandedImageIndex(null);
      onClose();
    } catch (error) {
      console.error("Failed to send message:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    if (!isLoading) {
      setSender(currentAgentName);
      setRecipient("");
      setSubject("");
      setBody("");
      attachments.forEach((attachment) => {
        if (attachment.previewUrl) {
          URL.revokeObjectURL(attachment.previewUrl);
        }
      });
      setAttachments([]);
      setExpandedImageIndex(null);
      onClose();
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title={
        <Text fw={600} size="lg">
          New Message
        </Text>
      }
      size="lg"
    >
      <Stack gap="md">
        <Select
          label="From"
          placeholder="Select sender"
          data={allAgentOptions}
          value={sender}
          onChange={(value) => setSender(value || currentAgentName)}
          required
          searchable
          disabled={isLoading}
        />

        <Select
          label="To"
          placeholder="Select recipient"
          data={availableRecipients}
          value={recipient}
          onChange={(value) => setRecipient(value || "")}
          required
          searchable
          disabled={isLoading}
        />

        <TextInput
          label="Subject"
          placeholder="Enter subject"
          value={subject}
          onChange={(event) => setSubject(event.currentTarget.value)}
          required
          disabled={isLoading}
        />

        <Textarea
          ref={bodyTextareaRef}
          label="Message"
          placeholder="Enter your message"
          value={body}
          onChange={(event) => setBody(event.currentTarget.value)}
          required
          minRows={4}
          maxRows={8}
          autosize
          disabled={isLoading}
        />

        <Box>
          <Group justify="space-between" align="center" mb="xs">
            <Text size="sm" fw={500}>
              Attachments
            </Text>
            <Dropzone
              onDrop={handleFilesAdd}
              disabled={isLoading}
              style={{
                cursor: isLoading ? "not-allowed" : "pointer",
                padding: "8px 12px",
                minHeight: "auto",
              }}
            >
              <Group gap="xs" style={{ pointerEvents: "none" }}>
                <IconPaperclip size={16} stroke={1.5} />
                <Text size="xs" c="dimmed">
                  Drag files here or click to select
                </Text>
              </Group>
            </Dropzone>
          </Group>

          {attachments.length > 0 && (
            <Stack gap="xs" mt="md">
              {attachments.map((attachment, index) => (
                <Paper key={index} p="sm" withBorder>
                  <Flex
                    align={
                      expandedImageIndex === index ? "flex-start" : "center"
                    }
                    gap="sm"
                  >
                    {attachment.previewUrl ? (
                      <Image
                        src={attachment.previewUrl}
                        alt={attachment.name}
                        w={expandedImageIndex === index ? "100%" : 60}
                        h={expandedImageIndex === index ? "auto" : 60}
                        fit={expandedImageIndex === index ? "contain" : "cover"}
                        radius="sm"
                        style={{
                          cursor: "pointer",
                          maxHeight:
                            expandedImageIndex === index ? "400px" : "60px",
                          transition: "all 0.2s ease",
                        }}
                        onClick={() =>
                          setExpandedImageIndex(
                            expandedImageIndex === index ? null : index,
                          )
                        }
                      />
                    ) : (
                      <Box
                        w={60}
                        h={60}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          backgroundColor: "var(--mantine-color-gray-1)",
                          borderRadius: "var(--mantine-radius-sm)",
                        }}
                      >
                        <IconFile size={24} />
                      </Box>
                    )}
                    <TextInput
                      value={getFileNameWithoutExtension(attachment.name)}
                      onChange={(event) =>
                        handleFileNameChange(index, event.currentTarget.value)
                      }
                      style={{ flex: 1 }}
                      disabled={isLoading}
                      rightSection={
                        <Text size="sm" c="dimmed">
                          {attachment.name.substring(
                            attachment.name.lastIndexOf("."),
                          ) || ""}
                        </Text>
                      }
                    />
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      onClick={() => handleFileRemove(index)}
                      disabled={isLoading}
                    >
                      <IconX size={16} />
                    </ActionIcon>
                  </Flex>
                </Paper>
              ))}
            </Stack>
          )}
        </Box>

        <Group justify="flex-end" gap="sm">
          <Button variant="outline" onClick={handleClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            onClick={handleSend}
            disabled={!recipient || !subject.trim() || !body.trim()}
            loading={isLoading}
          >
            Send
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
};
