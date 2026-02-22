import { ActionIcon, Group, Textarea } from "@mantine/core";
import { IconSend } from "@tabler/icons-react";
import React, { useEffect, useRef, useState } from "react";

interface ChatInputProps {
  onSend: (message: string) => Promise<void>;
  disabled?: boolean;
  focusKey?: string | null;
}

export const ChatInput: React.FC<ChatInputProps> = ({ onSend, disabled, focusKey }) => {
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus when conversation changes
  useEffect(() => {
    if (focusKey && inputRef.current) {
      inputRef.current.focus();
    }
  }, [focusKey]);

  const handleSend = async () => {
    const trimmed = message.trim();
    if (!trimmed || sending) return;

    setSending(true);
    try {
      await onSend(trimmed);
      setMessage("");
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

  return (
    <Group
      gap="xs"
      p="xs"
      style={{ borderTop: "1px solid var(--mantine-color-dark-4)" }}
      align="flex-end"
    >
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
        disabled={disabled || sending || !message.trim()}
        loading={sending}
      >
        <IconSend size={18} />
      </ActionIcon>
    </Group>
  );
};
