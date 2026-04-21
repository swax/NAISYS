import { formatFileSize } from "@naisys/common";

/** Content carried with mail delivery */
export interface MailContent {
  fromUsername: string;
  fromTitle: string;
  recipientUsernames: string[];
  subject: string;
  body: string;
  createdAt: string;
  attachments?: { id: string; filename: string; fileSize: number }[];
  /** Local-mode file paths (no hub upload) */
  filePaths?: string[];
}

/** Standard display format for a mail message */
export function formatMessageDisplay(
  content: MailContent,
  hubUrl?: string,
): string {
  let output =
    `  Subject: ${content.subject}\n` +
    `  From: ${content.fromUsername} (${content.fromTitle})\n` +
    `  To: ${content.recipientUsernames.join(", ")}\n` +
    `  Date: ${new Date(content.createdAt).toLocaleString()}\n` +
    `  Message:\n` +
    `  ${content.body}`;

  if (content.attachments?.length) {
    output += "\n  Attachments:";
    for (const att of content.attachments) {
      output += `\n    ${att.id}: ${att.filename} (${formatFileSize(att.fileSize)})`;
    }
    if (hubUrl) {
      output += "\n  Download:";
      for (const att of content.attachments) {
        output += `\n    curl -H "Authorization: Bearer $NAISYS_API_KEY" "${hubUrl}/attachments/${att.id}" -o ${att.filename}`;
      }
    }
  }

  if (content.filePaths?.length) {
    output += "\n  Attachments:";
    for (const fp of content.filePaths) {
      output += `\n    ${fp}`;
    }
  }

  return output;
}
