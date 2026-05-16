import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

const BOTTOM_STICKINESS_PX = 24;

export interface UseChatScrollOptions {
  threadKey: string;
  lastMessageId: number | null;
  messageCount: number;
  onThreadChange?: () => void;
}

export const useChatScroll = ({
  threadKey,
  lastMessageId,
  messageCount,
  onThreadChange,
}: UseChatScrollOptions) => {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const shouldStickToBottom = useRef(true);
  const lastScrollTop = useRef(0);
  const scrollFrame = useRef<number | null>(null);
  const previousThread = useRef<{
    threadKey: string;
    lastMessageId: number | null;
  }>({
    threadKey: "",
    lastMessageId: null,
  });

  // Stash callback in a ref so the layout effect doesn't need it as a dep.
  const onThreadChangeRef = useRef(onThreadChange);
  useEffect(() => {
    onThreadChangeRef.current = onThreadChange;
  });

  const scrollToBottom = useCallback(() => {
    const applyScroll = () => {
      const node = viewport.current;
      if (!node) return;

      node.scrollTop = node.scrollHeight;
      lastScrollTop.current = node.scrollTop;
    };

    applyScroll();

    if (scrollFrame.current !== null) {
      window.cancelAnimationFrame(scrollFrame.current);
    }

    scrollFrame.current = window.requestAnimationFrame(() => {
      scrollFrame.current = null;
      applyScroll();
    });
  }, []);

  const handleScrollPositionChange = useCallback(() => {
    const node = viewport.current;
    if (!node) return;

    const distanceFromBottom =
      node.scrollHeight - node.clientHeight - node.scrollTop;
    const isAtBottom = distanceFromBottom <= BOTTOM_STICKINESS_PX;
    const movedUp = node.scrollTop < lastScrollTop.current - 1;

    // Late content growth can move the bottom without a user action. Only an
    // actual upward scroll should disable bottom stickiness.
    if (isAtBottom) {
      shouldStickToBottom.current = true;
    } else if (movedUp) {
      shouldStickToBottom.current = false;
    }

    lastScrollTop.current = node.scrollTop;
  }, []);

  useEffect(() => {
    return () => {
      if (scrollFrame.current !== null) {
        window.cancelAnimationFrame(scrollFrame.current);
      }
    };
  }, []);

  // Auto-scroll on conversation load and when newer messages append. Loading
  // older messages keeps the same last message id, so it does not pull the
  // viewport back down.
  useLayoutEffect(() => {
    const previous = previousThread.current;
    const threadChanged = previous.threadKey !== threadKey;
    const lastMessageChanged = lastMessageId !== previous.lastMessageId;

    if (threadChanged) {
      shouldStickToBottom.current = true;
      onThreadChangeRef.current?.();
    }

    if (
      messageCount > 0 &&
      (threadChanged || (lastMessageChanged && shouldStickToBottom.current))
    ) {
      scrollToBottom();
    }

    previousThread.current = {
      threadKey,
      lastMessageId,
    };
  }, [lastMessageId, messageCount, scrollToBottom, threadKey]);

  // Keep the latest message visible when content height changes after the
  // initial scroll, for example when image attachments or run dividers load.
  useEffect(() => {
    if (
      messageCount === 0 ||
      !content.current ||
      typeof ResizeObserver === "undefined"
    ) {
      return;
    }

    const node = content.current;
    const observer = new ResizeObserver(() => {
      if (shouldStickToBottom.current) {
        scrollToBottom();
      }
    });

    observer.observe(node);
    return () => observer.disconnect();
  }, [messageCount, scrollToBottom, threadKey]);

  return {
    viewport,
    content,
    handleScrollPositionChange,
  };
};
