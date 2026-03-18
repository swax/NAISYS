import type { Components } from "react-markdown";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

const compactComponents: Components = {
  p: ({ children }) => <p style={{ margin: 0 }}>{children}</p>,
  ul: ({ children }) => (
    <ul style={{ margin: "0.25em 0", paddingLeft: "1.5em" }}>{children}</ul>
  ),
  ol: ({ children }) => (
    <ol style={{ margin: "0.25em 0", paddingLeft: "1.5em" }}>{children}</ol>
  ),
};

export const CompactMarkdown: React.FC<{ children: string }> = ({
  children,
}) => (
  <Markdown remarkPlugins={[remarkGfm]} components={compactComponents}>
    {children}
  </Markdown>
);
