export interface ThreadMessage {
  id: number;
  threadId: number;
  userId: number;
  username: string;
  subject: string;
  message: string;
  date: string;
  members: ThreadMember[];
}

export interface ThreadMember {
  userId: number;
  username: string;
  newMsgId: number;
  archived: boolean;
}

export interface SendMailRequest {
  from: string;
  to: string;
  subject: string;
  message: string;
  attachments?: Array<{
    filename: string;
    data: Buffer;
  }>;
}

export interface SendMailResponse {
  success: boolean;
  message?: string;
  messageId?: number;
}
