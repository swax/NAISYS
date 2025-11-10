import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { getMailData, MailDataParams, ThreadMessage } from "../lib/apiClient";

export const useMailData = (agentName: string, enabled: boolean = true) => {
  // Store merged mail per agentName
  const mailCache = useRef<Map<string, ThreadMessage[]>>(new Map());
  // Store updatedSince per agentName
  const updatedSinceCache = useRef<Map<string, string | undefined>>(new Map());
  // Version counter to trigger re-renders when cache updates
  const [, setCacheVersion] = useState(0);

  const queryFn = useCallback(async ({ queryKey }: any) => {
    const [, agentName] = queryKey;

    const params: MailDataParams = {
      agentName,
      updatedSince: updatedSinceCache.current.get(agentName),
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

      const existingMail = mailCache.current.get(agentName) || [];

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
      mailCache.current.set(agentName, sortedMail);

      // Update updatedSince with the current timestamp
      updatedSinceCache.current.set(agentName, new Date().toISOString());

      // Trigger re-render
      setCacheVersion((v) => v + 1);
    }
  }, [query.data, agentName]);

  // Get current mail from cache (already sorted)
  const mail = mailCache.current.get(agentName) || [];

  return {
    mail,
    isLoading: query.isLoading,
    error: query.error,
  };
};
