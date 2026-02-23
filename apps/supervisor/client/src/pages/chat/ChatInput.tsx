import { ActionIcon, Badge, Group, Stack, Textarea } from "@mantine/core";
import { IconPaperclip, IconSend, IconX } from "@tabler/icons-react";
import React, { useCallback, useEffect, useRef, useState } from "react";

interface ChatInputProps {
  onSend: (message: string, files?: File[]) => Promise<void>;
  disabled?: boolean;
  focusKey?: string | null;
}

export const ChatInput: React.FC<ChatInputProps> = ({
  onSend,
  disabled,
  focusKey,
}) => {
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-focus when conversation changes
  useEffect(() => {
    if (focusKey && inputRef.current) {
      inputRef.current.focus();
    }
  }, [focusKey]);

  const handleSend = async () => {
    const trimmed = message.trim();
    if ((!trimmed && files.length === 0) || sending) return;

    setSending(true);
    try {
      await onSend(trimmed, files.length > 0 ? files : undefined);
      setMessage("");
      setFiles([]);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles((prev) => [...prev, ...Array.from(e.target.files!)]);
    }
    // Reset so selecting the same file again triggers onChange
    e.target.value = "";
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files.length > 0) {
      setFiles((prev) => [...prev, ...Array.from(e.dataTransfer.files)]);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  return (
    <Stack
      gap={0}
      style={{ borderTop: "1px solid var(--mantine-color-dark-4)" }}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      {files.length > 0 && (
        <Group gap="xs" p="xs" pb={0} style={{ flexWrap: "wrap" }}>
          {files.map((file, index) => (
            <Badge
              key={`${file.name}-${index}`}
              variant="outline"
              rightSection={
                <IconX
                  size={12}
                  style={{ cursor: "pointer" }}
                  onClick={() => removeFile(index)}
                />
              }
              style={{ textTransform: "none", maxWidth: 200 }}
            >
              {file.name}
            </Badge>
          ))}
        </Group>
      )}
      <Group gap="xs" p="xs" align="flex-end">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: "none" }}
          onChange={handleFileSelect}
        />
        <ActionIcon
          variant="subtle"
          color="gray"
          size="lg"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || sending}
          title="Attach file"
        >
          <IconPaperclip size={18} />
        </ActionIcon>
        <Textarea
          ref={inputRef}
          placeholder="Type a message..."
          value={message}
          onChange={(e) => setMessage(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled || sending}
          autosize
          minRows={1}
          maxRows={4}
          style={{ flex: 1 }}
        />
        <ActionIcon
          variant="filled"
          color="blue"
          size="lg"
          onClick={handleSend}
          disabled={
            disabled || sending || (!message.trim() && files.length === 0)
          }
          loading={sending}
        >
          <IconSend size={18} />
        </ActionIcon>
      </Group>
    </Stack>
  );
};
