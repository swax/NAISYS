import type { HateoasAction } from "@naisys/common";
import type { MailPush } from "@naisys/hub-protocol";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAgentDataContext } from "../contexts/AgentDataContext";
import { MailMessage } from "../lib/apiClient";
import { getMailData, MailDataParams } from "../lib/apiMail";
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
      if (updatedMail.length === 0 && total === undefined) return;

      const existingMail = mailCache.get(agentId) || [];

      const mergeMap = new Map(
        existingMail.map((mail: MailMessage) => [mail.id, mail]),
      );

      const existingCount = mergeMap.size;

      updatedMail.forEach((mail) => {
        mergeMap.set(mail.id, mail);
      });

      const mergedMail = Array.from(mergeMap.values());
      const newCount = mergedMail.length - existingCount;

      // Sort newest first
      mergedMail.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );

      mailCache.set(agentId, mergedMail);

      if (total !== undefined) {
        totalCache.set(agentId, total);
      } else if (newCount > 0) {
        const currentTotal = totalCache.get(agentId) || 0;
        totalCache.set(agentId, currentTotal + newCount);
      }

      updatedSinceCache.set(agentId, new Date().toISOString());

      setCacheVersion((v) => v + 1);
    },
    [agentId],
  );

  const handleMailPush = useCallback(
    (event: MailPush) => {
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
    },
    [mergeMail, userLookup],
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

  // WebSocket subscription for real-time mail updates
  useSubscription<MailPush>(
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
