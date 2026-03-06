import type { HateoasAction } from "@naisys/common";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAgentDataContext } from "../contexts/AgentDataContext";
import { MailMessage } from "../lib/apiClient";
import { getMailData, MailDataParams } from "../lib/apiMail";
import { mergeIntoCache, MessageRoomEvent } from "./messageCacheUtils";
import { useSubscription } from "./useSubscription";

// Module-level caches (shared across all hook instances and persist across remounts)
const mailCache = new Map<number, MailMessage[]>();
const updatedSinceCache = new Map<number, string | undefined>();
const totalCache = new Map<number, number>();
let actionsCache: HateoasAction[] | undefined = undefined;

export const useMailData = (agentId: number, enabled: boolean = true) => {
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
          agentId,
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
    [agentId],
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
          const cached = mailCache.get(agentId);
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
    [agentId, mergeMail, userLookup],
  );

  const queryFn = useCallback(async ({ queryKey }: any) => {
    const [, agentId] = queryKey;

    const params: MailDataParams = {
      agentId,
      updatedSince: updatedSinceCache.get(agentId),
      page: 1,
      count: 50,
    };

    return await getMailData(params);
  }, []);

  const query = useQuery({
    queryKey: ["mail-data", agentId],
    queryFn,
    enabled: enabled && !!agentId,
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
    enabled && agentId ? `mail:${agentId}` : null,
    handleMailPush,
  );

  const mail = mailCache.get(agentId) || [];
  const total = totalCache.get(agentId) || 0;

  return {
    mail,
    total,
    actions: actionsCache,
    isLoading: query.isLoading,
    error: query.error,
  };
};
