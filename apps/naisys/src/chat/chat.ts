import {
  HubEvents,
  MailListMessageData,
  MailListResponse,
  MailReceivedPush,
  MailSendResponse,
  MailUnreadResponse,
} from "@naisys/hub-protocol";
import stringArgv from "string-argv";
import { UserEntry, UserService } from "../agent/userService.js";
import { chatCmd } from "../command/commandDefs.js";
import { RegistrableCommand } from "../command/commandRegistry.js";
import { HubClient } from "../hub/hubClient.js";
import { PromptNotificationService } from "../utils/promptNotificationService.js";

export function createChatService(
  hubClient: HubClient | undefined,
  userService: UserService,
  localUserId: number,
  promptNotification: PromptNotificationService,
) {
  async function handleCommand(args: string): Promise<string> {
    const argv = stringArgv(args);

    if (!argv[0]) {
      argv[0] = "help";
    }

    switch (argv[0]) {
      case "help": {
        const subs = chatCmd.subcommands!;
        const lines = [`${chatCmd.name} <command>`];
        lines.push(`  ${subs.send.usage.padEnd(40)}${subs.send.description}`);
        if (hubClient) {
          lines.push(
            `  ${subs.recent.usage.padEnd(40)}${subs.recent.description}`,
          );
        }
        return lines.join("\n");
      }

      case "send": {
        // Expected: ns-chat send "user1,user2" "message"
        if (!argv[1] || !argv[2]) {
          throw 'Invalid parameters. Usage: ns-chat send "users" "message"';
        }

        const recipients = userService.resolveUsernames(argv[1]);
        return sendMessage(recipients, argv[2]);
      }

      case "recent": {
        if (!hubClient) {
          throw "Not available in local mode.";
        }

        const withUserIds = argv[1]
          ? userService.resolveUsernames(argv[1]).map((r) => r.userId)
          : undefined;

        const skip = argv[2] ? parseInt(argv[2]) : undefined;
        const take = argv[3] ? parseInt(argv[3]) : undefined;

        if (argv[2] && isNaN(skip!)) {
          throw "Invalid skip parameter. Must be a number.";
        }
        if (argv[3] && isNaN(take!)) {
          throw "Invalid take parameter. Must be a number.";
        }

        return recentMessages(withUserIds, skip, take);
      }

      default: {
        const helpResponse = await handleCommand("help");
        return (
          "Error, unknown command. See valid commands below:\n" + helpResponse
        );
      }
    }
  }

  async function sendMessage(
    recipients: UserEntry[],
    message: string,
  ): Promise<string> {
    message = message.replace(/\\n/g, "\n");

    if (hubClient) {
      const response = await hubClient.sendRequest<MailSendResponse>(
        HubEvents.MAIL_SEND,
        {
          fromUserId: localUserId,
          toUserIds: recipients.map((r) => r.userId),
          subject: "",
          body: message,
          kind: "chat",
        },
      );

      if (!response.success) {
        throw response.error || "Failed to send chat message";
      }

      return "Chat sent";
    }

    // Local mode: notify recipients directly with compact format
    const localUser = userService.getUserById(localUserId);
    const localUsername = localUser?.username || "unknown";

    for (const recipient of recipients) {
      promptNotification.notify({
        userId: recipient.userId,
        wake: "yes",
        contextOutput: [`Chat from ${localUsername}: ${message}`],
      });
    }

    return "Chat sent";
  }

  async function recentMessages(
    withUserIds?: number[],
    skip?: number,
    take?: number,
  ): Promise<string> {
    if (!hubClient) throw "Not available in local mode.";

    const response = await hubClient.sendRequest<MailListResponse>(
      HubEvents.MAIL_LIST,
      {
        userId: localUserId,
        kind: "chat",
        skip,
        take: take ?? 10,
        ...(withUserIds ? { withUserIds } : {}),
      },
    );

    if (!response.success) {
      throw response.error || "Failed to list chat messages";
    }

    const messages = response.messages;
    if (!messages || messages.length === 0) {
      return "No chat messages.";
    }

    // Reverse to show chronological order (oldest first)
    const conversation = !!withUserIds;
    const chronological = [...messages].reverse();

    return chronological
      .map((m) => formatChatLine(m, conversation ? "conversation" : "overview"))
      .join("\n");
  }

  /**
   * Format a chat message for display.
   * Modes control how much participant context is shown:
   *   conversation - viewing a specific chat (participants known), just show sender
   *   overview     - viewing all chats (mixed conversations), show who's involved
   *                  1:1: "alice → bob", group: "[alice,bob,carol] alice"
   *   notify       - incoming notification, show group context but keep 1:1 simple
   *                  1:1: "alice", group: "[alice,bob,carol] alice"
   */
  function formatChatLine(
    m: MailListMessageData,
    mode: "conversation" | "overview" | "notify",
  ): string {
    const prefix = m.isUnread ? "* " : "  ";
    const date = new Date(m.createdAt);
    const MM = String(date.getMonth() + 1).padStart(2, "0");
    const DD = String(date.getDate()).padStart(2, "0");
    const HH = String(date.getHours()).padStart(2, "0");
    const mm = String(date.getMinutes()).padStart(2, "0");
    const dateStr = `${MM}/${DD} ${HH}:${mm}`;

    const isGroup = m.recipientUsernames.length > 1;
    let sender: string;
    if (mode === "conversation") {
      // Participants already known from the command context
      sender = m.fromUsername;
    } else if (mode === "notify") {
      if (isGroup) {
        // Group context needed so agent knows which conversation
        const participants = [m.fromUsername, ...m.recipientUsernames]
          .sort()
          .join(",");
        sender = `[${participants}] ${m.fromUsername}`;
      } else {
        // 1:1 is obvious from sender alone
        sender = m.fromUsername;
      }
    } else {
      // overview: messages from different conversations are mixed
      if (isGroup) {
        const participants = [m.fromUsername, ...m.recipientUsernames]
          .sort()
          .join(",");
        sender = `[${participants}] ${m.fromUsername}`;
      } else {
        // Show direction so agent can distinguish different 1:1 conversations
        sender = `${m.fromUsername} → ${m.recipientUsernames[0]}`;
      }
    }

    return `${prefix}${dateStr}: ${sender}: ${m.body ?? ""}`;
  }

  // Track message IDs that have been notified but not yet processed
  const notifiedMessageIds = new Set<number>();

  async function checkAndNotify(): Promise<void> {
    if (!hubClient) return;

    const response = await hubClient.sendRequest<MailUnreadResponse>(
      HubEvents.MAIL_UNREAD,
      { userId: localUserId, kind: "chat" },
    );

    if (!response.success || !response.messageIds) return;

    const newIds = response.messageIds.filter(
      (id) => !notifiedMessageIds.has(id),
    );
    if (!newIds.length) return;

    newIds.forEach((id) => notifiedMessageIds.add(id));

    // Fetch recent messages to display them compactly
    const listResponse = await hubClient.sendRequest<MailListResponse>(
      HubEvents.MAIL_LIST,
      {
        userId: localUserId,
        kind: "chat",
        take: newIds.length,
      },
    );

    if (!listResponse.success || !listResponse.messages) return;

    // Only show messages that are actually new/unread
    const unreadMessages = listResponse.messages.filter((m) =>
      newIds.includes(m.id),
    );

    if (!unreadMessages.length) return;

    const contextOutput = [
      "New chat messages:",
      ...unreadMessages.map((m) => formatChatLine(m, "notify")),
    ];

    promptNotification.notify({
      userId: localUserId,
      wake: "yes",
      contextOutput,
      processed: () => {
        newIds.forEach((id) => notifiedMessageIds.delete(id));
      },
    });
  }

  // Set up notification listeners based on mode
  let cleanupFn: () => void;

  if (hubClient) {
    const chatReceivedHandler = (data: unknown) => {
      const push = data as MailReceivedPush;
      if (push.kind !== "chat") return;
      if (push.recipientUserIds.includes(localUserId)) {
        void checkAndNotify();
      }
    };
    hubClient.registerEvent(HubEvents.MAIL_RECEIVED, chatReceivedHandler);

    cleanupFn = () => {
      hubClient.unregisterEvent(HubEvents.MAIL_RECEIVED, chatReceivedHandler);
    };
  } else {
    cleanupFn = () => {};
  }

  function cleanup() {
    cleanupFn();
  }

  const registrableCommand: RegistrableCommand = {
    command: chatCmd,
    handleCommand,
  };

  return {
    ...registrableCommand,
    checkAndNotify,
    cleanup,
  };
}

export type ChatService = ReturnType<typeof createChatService>;
