import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import type { MailMessage } from "../../lib/api/apiClient";
import { getMailData } from "../../lib/api/apiMail";
import { queryKeys } from "../../lib/api/queryKeys";
import {
  type ListInfiniteData,
  prependToPage0,
  updateItems,
} from "../infinite/pageCache";
import { useInfiniteListGapRecovery } from "../infinite/useInfiniteListGapRecovery";
import { useLiveInfiniteList } from "../infinite/useLiveInfiniteList";
import type { MessageRoomEvent } from "../socket/messageRoomEvents";
import { useSubscription } from "../socket/useSubscription";
import { useAgentLookups } from "./useAgentLookups";

/** Page size for the initial fetch and each `loadMore`. */
const PAGE_SIZE = 50;

const mailKey = (m: MailMessage) => m.id;
const mailSortValue = (m: MailMessage) => new Date(m.createdAt).getTime();

/**
 * A live, paginated mail list, backed by `useLiveInfiniteList`. The
 * `mail:${username}` socket room keeps it current — a new message is spliced
 * onto page 0, a read receipt folded across every page. A missing
 * `previousMessageId` means a push was dropped, so the list reconciles with a
 * refetch.
 */
export const useMailData = (agentUsername: string, enabled: boolean = true) => {
  const { userLookup, titleLookup } = useAgentLookups();
  const queryClient = useQueryClient();

  const queryKey = useMemo(
    () => queryKeys.mailData(agentUsername),
    [agentUsername],
  );

  const list = useLiveInfiniteList<MailMessage>({
    queryKey,
    enabled: enabled && !!agentUsername,
    fetchPage: async (page) => {
      const result = await getMailData({
        agentUsername,
        page,
        count: PAGE_SIZE,
      });
      return {
        items: result.data?.mail ?? [],
        total: result.data?.total ?? 0,
        actions: result._actions,
      };
    },
    getItemKey: mailKey,
    getRecency: mailKey,
    getSortValue: mailSortValue,
    descending: true,
  });

  const checkGap = useInfiniteListGapRecovery(queryKey, mailKey, "useMailData");

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
            attachments: event.attachments as MailMessage["attachments"],
          };
          queryClient.setQueryData<ListInfiniteData<MailMessage>>(
            queryKey,
            (old) => prependToPage0(old, msg, mailKey),
          );
          checkGap(event.previousMessageId, event.messageId);
          break;
        }
        case "read-receipt": {
          const readAt = new Date().toISOString();
          queryClient.setQueryData<ListInfiniteData<MailMessage>>(
            queryKey,
            (old) =>
              updateItems(old, (m) => {
                if (!event.messageIds.includes(m.id)) return m;
                let changed = false;
                const recipients = m.recipients.map((r) => {
                  if (r.userId === event.userId && !r.readAt) {
                    changed = true;
                    return { ...r, readAt };
                  }
                  return r;
                });
                return changed ? { ...m, recipients } : m;
              }),
          );
          break;
        }
      }
    },
    [queryClient, queryKey, checkGap, userLookup, titleLookup],
  );

  useSubscription<MessageRoomEvent>(
    enabled && agentUsername ? `mail:${agentUsername}` : null,
    handleMailPush,
  );

  return {
    mail: list.items,
    total: list.total,
    actions: list.actions,
    isLoading: list.isLoading,
    error: list.error,
    loadMore: list.loadMore,
    loadingMore: list.loadingMore,
    hasMore: list.hasMore,
    refresh: list.refresh,
  };
};
