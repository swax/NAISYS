import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { getMailData, MailDataParams, MailMessage } from "../lib/apiClient";

// Module-level caches (shared across all hook instances and persist across remounts)
const mailCache = new Map<string, MailMessage[]>();
const updatedSinceCache = new Map<string, string | undefined>();
const totalCache = new Map<string, number>();

export const useMailData = (agentName: string, enabled: boolean = true) => {
  // Version counter to trigger re-renders when cache updates
  const [, setCacheVersion] = useState(0);

  const queryFn = useCallback(async ({ queryKey }: any) => {
    const [, agentName] = queryKey;

    const params: MailDataParams = {
      agentName,
      updatedSince: updatedSinceCache.get(agentName),
      page: 1,
      count: 50,
    };

    return await getMailData(params);
  }, []);

  const query = useQuery({
    queryKey: ["mail-data", agentName],
    queryFn,
    enabled: enabled && agentName.length > 0,
    refetchInterval: 5000, // Poll every 5 seconds
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnMount: "always", // Immediate update when userId changes
    retry: 3,
    retryDelay: 1000,
  });

  // Merge new data when it arrives
  useEffect(() => {
    if (query.data?.success && query.data.data) {
      const updatedMail = query.data.data.mail;
      const total = query.data.data.total;

      const existingMail = mailCache.get(agentName) || [];

      // Create a map of existing mail for quick lookup
      const mergeMail = new Map(
        existingMail.map((mail: MailMessage) => [mail.id, mail]),
      );

      // Count how many new mail items we're adding
      const existingCount = mergeMail.size;

      // Update existing mail and add new ones
      updatedMail.forEach((mail) => {
        mergeMail.set(mail.id, mail);
      });

      const mergedMail = Array.from(mergeMail.values());
      const newCount = mergedMail.length - existingCount;

      // Sort once when updating cache (newest first)
      const sortedMail = mergedMail.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );

      // Update cache with sorted mail
      mailCache.set(agentName, sortedMail);

      // Update total cache
      if (total !== undefined) {
        // Initial fetch with total count
        totalCache.set(agentName, total);
      } else if (newCount > 0) {
        // Incremental fetch - add new items to existing total
        const currentTotal = totalCache.get(agentName) || 0;
        totalCache.set(agentName, currentTotal + newCount);
      }

      // Update updatedSince with the current timestamp
      updatedSinceCache.set(agentName, new Date().toISOString());

      // Trigger re-render
      setCacheVersion((v) => v + 1);
    }
  }, [query.data, agentName]);

  // Get current mail from cache (already sorted)
  const mail = mailCache.get(agentName) || [];
  const total = totalCache.get(agentName) || 0;

  return {
    mail,
    total,
    isLoading: query.isLoading,
    error: query.error,
  };
};
