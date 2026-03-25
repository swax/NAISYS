import type { HateoasAction } from "@naisys/common";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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

// Tracks gap recovery attempts per agent to prevent re-fetch loops
const gapRecoveryAttempted = new Map<string, Set<string>>();

export const useMailData = (agentUsername: string, enabled: boolean = true) => {
  const { agents } = useAgentDataContext();
  const userLookup = useMemo(
    () => new Map(agents.map((a) => [a.id, a.name])),
    [agents],
  );
  const titleLookup = useMemo(
    () => new Map(agents.map((a) => [a.id, a.title])),
    [agents],
  );
  const [, setCacheVersion] = useState(0);
  const queryClient = useQueryClient();

  // Clean up gap recovery state when leaving an agent's mail
  useEffect(() => {
    return () => {
      gapRecoveryAttempted.delete(agentUsername);
    };
  }, [agentUsername]);

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

  const recoverMail = useCallback(
    (previousMessageId: number, currentMessageId: number) => {
      const gapKey = `${previousMessageId}-${currentMessageId}`;
      const attempted = gapRecoveryAttempted.get(agentUsername) ?? new Set();
      if (attempted.has(gapKey)) return;
      attempted.add(gapKey);
      gapRecoveryAttempted.set(agentUsername, attempted);

      console.info(
        `[useMailData] Gap recovery for ${agentUsername}: clearing cache and refetching`,
      );

      // Clear timestamp so next fetch gets all messages
      updatedSinceCache.delete(agentUsername);
      void queryClient.invalidateQueries({
        queryKey: ["mail-data", agentUsername],
      });
    },
    [agentUsername, queryClient],
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
            fromTitle: titleLookup.get(event.fromUserId) ?? "",
            subject: event.subject ?? "",
            body: event.body,
            createdAt: event.createdAt,
            recipients: event.recipientUserIds.map((uid) => ({
              userId: uid,
              username: userLookup.get(uid) ?? String(uid),
              title: titleLookup.get(uid) ?? "",
              type: "to",
              readAt: null,
            })),
            attachments: event.attachments,
          };
          mergeMail([msg]);

          // Gap detection: check if previousMessageId exists in cache
          if (event.previousMessageId != null) {
            const cached = mailCache.get(agentUsername);
            if (cached && cached.length > 0) {
              const hasPrevious = cached.some(
                (m) => m.id === event.previousMessageId,
              );
              if (!hasPrevious) {
                console.warn(
                  `[useMailData] Gap detected for ${agentUsername}: missing previousMessageId ${event.previousMessageId}`,
                );
                recoverMail(event.previousMessageId, event.messageId);
              }
            }
          }
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
    [agentUsername, mergeMail, recoverMail, userLookup, titleLookup],
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
