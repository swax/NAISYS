import { ActionIcon, Image, Modal } from "@mantine/core";
import { ATTACHMENT_NO_ACCESS, isImageFilename } from "@naisys/common";
import { IconArrowLeft, IconArrowRight } from "@tabler/icons-react";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import type { LogEntry } from "../../lib/apiClient";

type GalleryImage = {
  url: string;
  filename: string;
  date: string;
};

type ImageGalleryContextType = {
  openImage: (url: string) => void;
};

const ImageGalleryContext = createContext<ImageGalleryContextType>({
  openImage: () => {},
});

export const useImageGallery = () => useContext(ImageGalleryContext);

export const ImageGalleryProvider: React.FC<{
  logs: LogEntry[];
  children: React.ReactNode;
}> = ({ logs, children }) => {
  const images = useMemo(() => {
    const result: GalleryImage[] = [];
    for (const log of logs) {
      if (
        log.attachment &&
        log.attachment.id !== ATTACHMENT_NO_ACCESS &&
        isImageFilename(log.attachment.filename)
      ) {
        result.push({
          url: log.attachment.downloadUrl,
          filename: log.attachment.filename,
          date: new Date(log.createdAt).toLocaleString(),
        });
      }
    }
    return result;
  }, [logs]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [opened, setOpened] = useState(false);

  const openImage = useCallback(
    (url: string) => {
      const idx = images.findIndex((img) => img.url === url);
      if (idx >= 0) {
        setCurrentIndex(idx);
        setOpened(true);
      }
    },
    [images],
  );

  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < images.length - 1;

  useEffect(() => {
    if (!opened) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        setCurrentIndex((i) => Math.max(0, i - 1));
      } else if (e.key === "ArrowRight") {
        setCurrentIndex((i) => Math.min(images.length - 1, i + 1));
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [opened, images.length]);

  const current = images[currentIndex];

  return (
    <ImageGalleryContext.Provider value={{ openImage }}>
      {children}
      <Modal
        opened={opened}
        onClose={() => setOpened(false)}
        size="xl"
        centered
        title={
          current
            ? `${current.filename} — ${current.date} (${currentIndex + 1} / ${images.length})`
            : undefined
        }
        styles={{
          body: {
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            position: "relative",
          },
        }}
      >
        {current && (
          <>
            <Image
              src={current.url}
              alt={current.filename}
              maw="100%"
              mah="70vh"
              fit="contain"
              radius="sm"
              style={{ cursor: "pointer" }}
              onClick={() => window.open(current.url, "_blank")}
            />
            {images.length > 1 && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "center",
                  gap: 16,
                  marginTop: 12,
                }}
              >
                <ActionIcon
                  variant="default"
                  size="lg"
                  disabled={!hasPrev}
                  onClick={() => setCurrentIndex((i) => i - 1)}
                >
                  <IconArrowLeft size={20} />
                </ActionIcon>
                <ActionIcon
                  variant="default"
                  size="lg"
                  disabled={!hasNext}
                  onClick={() => setCurrentIndex((i) => i + 1)}
                >
                  <IconArrowRight size={20} />
                </ActionIcon>
              </div>
            )}
          </>
        )}
      </Modal>
    </ImageGalleryContext.Provider>
  );
};
