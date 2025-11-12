import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { getMailData, MailDataParams, ThreadMessage } from "../lib/apiClient";

// Module-level caches (shared across all hook instances and persist across remounts)
const mailCache = new Map<string, ThreadMessage[]>();
const updatedSinceCache = new Map<string, string | undefined>();

export const useMailData = (agentName: string, enabled: boolean = true) => {
  // Version counter to trigger re-renders when cache updates
  const [, setCacheVersion] = useState(0);

  const queryFn = useCallback(async ({ queryKey }: any) => {
    const [, agentName] = queryKey;

    const params: MailDataParams = {
      agentName,
      updatedSince: updatedSinceCache.get(agentName),
    };

    return await getMailData(params);
  }, []);

  const query = useQuery({
    queryKey: ["mail-data", agentName],
    queryFn,
    enabled: enabled && agentName.length > 0,
    refetchInterval: 5000, // Poll every 5 seconds
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: false,
    retry: 3,
    retryDelay: 1000,
  });

  // Merge new data when it arrives
  useEffect(() => {
    if (query.data?.success && query.data.data) {
      const updatedMail = query.data.data.mail;

      const existingMail = mailCache.get(agentName) || [];

      // Create a map of existing mail for quick lookup
      const mergeMail = new Map(
        existingMail.map((mail: ThreadMessage) => [mail.id, mail]),
      );

      // Update existing mail and add new ones
      updatedMail.forEach((mail) => {
        mergeMail.set(mail.id, mail);
      });

      const mergedMail = Array.from(mergeMail.values());

      // Sort once when updating cache (newest first)
      const sortedMail = mergedMail.sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
      );

      // Update cache with sorted mail
      mailCache.set(agentName, sortedMail);

      // Update updatedSince with the current timestamp
      updatedSinceCache.set(agentName, new Date().toISOString());

      // Trigger re-render
      setCacheVersion((v) => v + 1);
    }
  }, [query.data, agentName]);

  // Get current mail from cache (already sorted)
  const mail = mailCache.get(agentName) || [];

  return {
    mail,
    isLoading: query.isLoading,
    error: query.error,
  };
};
