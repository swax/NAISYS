import { diffWordsWithSpace } from "diff";
import { useMemo } from "react";

export interface InlineWordDiffProps {
  /** The "from" / older text. */
  oldText: string;
  /** The "to" / newer text. */
  newText: string;
  /** Which side to render — "old" shows removals highlighted, "new" shows additions. */
  side: "old" | "new";
}

const HIGHLIGHT_BG_OLD =
  "light-dark(rgba(255, 99, 99, 0.42), rgba(255, 99, 99, 0.45))";
const HIGHLIGHT_BG_NEW =
  "light-dark(rgba(80, 200, 120, 0.42), rgba(80, 200, 120, 0.45))";

/**
 * Renders one side of a word-level inline text diff. Pair two instances
 * (one with side="old", one with side="new") to show the before/after.
 */
export const InlineWordDiff: React.FC<InlineWordDiffProps> = ({
  oldText,
  newText,
  side,
}) => {
  const parts = useMemo(
    () => diffWordsWithSpace(oldText, newText),
    [oldText, newText],
  );
  const highlightBg = side === "old" ? HIGHLIGHT_BG_OLD : HIGHLIGHT_BG_NEW;
  return (
    <>
      {parts.map((p, i) => {
        if (side === "old" && p.added) return null;
        if (side === "new" && p.removed) return null;
        const isChange = side === "old" ? p.removed : p.added;
        return isChange ? (
          <span key={i} style={{ background: highlightBg, borderRadius: 2 }}>
            {p.value}
          </span>
        ) : (
          <span key={i}>{p.value}</span>
        );
      })}
    </>
  );
};
