import type { Components } from "react-markdown";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

const compactComponents: Components = {
  p: ({ children }) => (
    <p style={{ marginBlockStart: "0.5em", marginBlockEnd: "0.5em" }}>
      {children}
    </p>
  ),
  blockquote: ({ children }) => (
    <blockquote
      style={{
        marginBlockStart: "0em",
        marginBlockEnd: "0em",
      }}
    >
      {children}
    </blockquote>
  ),
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
