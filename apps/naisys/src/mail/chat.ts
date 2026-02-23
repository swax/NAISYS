import {
  HubEvents,
  MailAttachmentData,
  MailListMessageData,
  MailListResponse,
  MailMarkReadResponse,
  MailMessageData,
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
import { MailAttachmentService } from "./mailAttachmentService.js";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/** Format inline attachment suffix, e.g. " [file.txt 2.1KB]" */
function formatAttachmentSuffix(attachments?: MailAttachmentData[]): string {
  if (!attachments?.length) return "";
  return attachments
    .map((a) => ` [${a.filename} ${formatSize(a.fileSize)}]`)
    .join("");
}

/** Build download commands for all attachments in a batch of messages */
function formatDownloadFooter(
  hubUrl: string,
  messages: { attachments?: MailAttachmentData[] }[],
): string {
  const allAttachments = messages.flatMap((m) => m.attachments ?? []);
  if (!allAttachments.length) return "";
  return (
    "\nDownload:\n" +
    allAttachments
      .map(
        (a) =>
          `  curl -k "${hubUrl}/attachments/${a.id}?apiKey=$NAISYS_API_KEY" -o ${a.filename}`,
      )
      .join("\n")
  );
}

export function createChatService(
  hubClient: HubClient | undefined,
  userService: UserService,
  localUserId: number,
  promptNotification: PromptNotificationService,
  attachmentService: MailAttachmentService,
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
        // Expected: ns-chat send "user1,user2" "message" [file1 file2 ...]
        if (!argv[1] || !argv[2]) {
          throw 'Invalid parameters. Usage: ns-chat send "users" "message"';
        }

        const recipients = userService.resolveUsernames(argv[1]);

        // Upload any file attachments (argv[3+])
        let attachmentIds: number[] | undefined;
        const filePaths = argv.slice(3);
        if (filePaths.length > 0) {
          attachmentIds = await attachmentService.resolveAndUpload(filePaths);
        }

        return sendMessage(recipients, argv[2], attachmentIds);
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
    attachmentIds?: number[],
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
          attachmentIds,
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

    let output = chronological
      .map((m) => formatChatLine(m, conversation ? "conversation" : "overview"))
      .join("\n");

    if (hubClient) {
      output += formatDownloadFooter(hubClient.getHubUrl(), chronological);
    }

    return output;
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

    return `${prefix}${dateStr}: ${sender}: ${m.body ?? ""}${formatAttachmentSuffix(m.attachments)}`;
  }

  /** Format a MailMessageData (from MAIL_UNREAD) as a chat line for notifications */
  function formatUnreadChatLine(m: MailMessageData): string {
    const date = new Date(m.createdAt);
    const MM = String(date.getMonth() + 1).padStart(2, "0");
    const DD = String(date.getDate()).padStart(2, "0");
    const HH = String(date.getHours()).padStart(2, "0");
    const mm = String(date.getMinutes()).padStart(2, "0");
    const dateStr = `${MM}/${DD} ${HH}:${mm}`;

    const isGroup = m.recipientUsernames.length > 1;
    let sender: string;
    if (isGroup) {
      const participants = [m.fromUsername, ...m.recipientUsernames]
        .sort()
        .join(",");
      sender = `[${participants}] ${m.fromUsername}`;
    } else {
      sender = m.fromUsername;
    }

    return `* ${dateStr}: ${sender}: ${m.body}${formatAttachmentSuffix(m.attachments)}`;
  }

  /** Highest message ID we've seen from MAIL_UNREAD, used as cursor */
  let lastUnreadId = 0;

  async function markMessagesRead(messageIds: number[]): Promise<void> {
    if (!hubClient || !messageIds.length) return;

    await hubClient.sendRequest<MailMarkReadResponse>(
      HubEvents.MAIL_MARK_READ,
      { userId: localUserId, messageIds },
    );
  }

  async function checkAndNotify(): Promise<void> {
    if (!hubClient) return;

    const response = await hubClient.sendRequest<MailUnreadResponse>(
      HubEvents.MAIL_UNREAD,
      { userId: localUserId, kind: "chat", afterId: lastUnreadId },
    );

    if (!response.success || !response.messages?.length) return;

    const messages = response.messages;

    // Advance cursor to max returned ID
    for (const m of messages) {
      if (m.id > lastUnreadId) {
        lastUnreadId = m.id;
      }
    }

    const messageIds = messages.map((m) => m.id);

    const lines = messages.map((m) => formatUnreadChatLine(m));
    const downloadFooter = formatDownloadFooter(
      hubClient.getHubUrl(),
      messages,
    );
    const contextOutput = [
      "New chat messages:",
      ...lines,
      ...(downloadFooter ? [downloadFooter] : []),
    ];

    promptNotification.notify({
      userId: localUserId,
      wake: "yes",
      contextOutput,
      processed: () => markMessagesRead(messageIds),
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
