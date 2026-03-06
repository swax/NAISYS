import type { HateoasAction } from "@naisys/common";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAgentDataContext } from "../contexts/AgentDataContext";
import { MailMessage } from "../lib/apiClient";
import { getMailData, MailDataParams } from "../lib/apiMail";
import { mergeIntoCache, MessageRoomEvent } from "./messageCacheUtils";
import { useSubscription } from "./useSubscription";

// Module-level caches (shared across all hook instances and persist across remounts)
const mailCache = new Map<string, MailMessage[]>();
const updatedSinceCache = new Map<string, string | undefined>();
const totalCache = new Map<string, number>();
let actionsCache: HateoasAction[] | undefined = undefined;

export const useMailData = (agentUsername: string, enabled: boolean = true) => {
  const { agents } = useAgentDataContext();
  const userLookup = useMemo(
    () => new Map(agents.map((a) => [a.id, a.name])),
    [agents],
  );
  const [, setCacheVersion] = useState(0);

  const mergeMail = useCallback(
    (updatedMail: MailMessage[], total?: number) => {
      if (
        mergeIntoCache(
          agentUsername,
          updatedMail,
          total,
          mailCache,
          totalCache,
          updatedSinceCache,
          true,
        )
      ) {
        setCacheVersion((v) => v + 1);
      }
    },
    [agentUsername],
  );

  const handleMailPush = useCallback(
    (event: MessageRoomEvent) => {
      switch (event.type) {
        case "new-message": {
          const msg: MailMessage = {
            id: event.messageId,
            fromUserId: event.fromUserId,
            fromUsername:
              userLookup.get(event.fromUserId) ?? String(event.fromUserId),
            subject: event.subject ?? "",
            body: event.body,
            createdAt: event.createdAt,
            recipients: event.recipientUserIds.map((uid) => ({
              userId: uid,
              username: userLookup.get(uid) ?? String(uid),
              type: "to",
              readAt: null,
            })),
          };
          mergeMail([msg]);
          break;
        }
        case "read-receipt": {
          const cached = mailCache.get(agentUsername);
          if (!cached) return;

          let changed = false;
          for (const msg of cached) {
            if (event.messageIds.includes(msg.id)) {
              const recipient = msg.recipients.find(
                (r) => r.userId === event.userId,
              );
              if (recipient && !recipient.readAt) {
                recipient.readAt = new Date().toISOString();
                changed = true;
              }
            }
          }
          if (changed) setCacheVersion((v) => v + 1);
          break;
        }
      }
    },
    [agentUsername, mergeMail, userLookup],
  );

  const queryFn = useCallback(async ({ queryKey }: any) => {
    const [, agentUsername] = queryKey;

    const params: MailDataParams = {
      agentUsername,
      updatedSince: updatedSinceCache.get(agentUsername),
      page: 1,
      count: 50,
    };

    return await getMailData(params);
  }, []);

  const query = useQuery({
    queryKey: ["mail-data", agentUsername],
    queryFn,
    enabled: enabled && !!agentUsername,
    refetchInterval: false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnMount: "always",
    retry: 3,
    retryDelay: 1000,
  });

  // Merge REST data when it arrives
  useEffect(() => {
    if (query.data?._actions) {
      actionsCache = query.data._actions;
    }
    if (query.data?.success && query.data.data) {
      mergeMail(query.data.data.mail, query.data.data.total);
    }
  }, [query.data, mergeMail]);

  // WebSocket subscription for real-time mail and read receipt updates
  useSubscription<MessageRoomEvent>(
    enabled && agentUsername ? `mail:${agentUsername}` : null,
    handleMailPush,
  );

  const mail = mailCache.get(agentUsername) || [];
  const total = totalCache.get(agentUsername) || 0;

  return {
    mail,
    total,
    actions: actionsCache,
    isLoading: query.isLoading,
    error: query.error,
  };
};
