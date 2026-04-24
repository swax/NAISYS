export type CanonicalModifier = "ctrl" | "alt" | "shift" | "meta" | "fn";

export interface CanonicalKeyChord {
  modifiers: CanonicalModifier[];
  keys: string[];
}

// How long each chord in a press is held down. Matches typical human keypress
// duration (~100ms) and, crucially, spans enough frames (~6 @ 60Hz) for games
// and emulators to reliably sample the input. Agent loops think and screenshot
// between presses, so the throughput cost is irrelevant here — reliability wins.
export const PRESS_KEY_HOLD_MS = 100;

const MODIFIER_ALIASES = new Map<string, CanonicalModifier>([
  ["ctrl", "ctrl"],
  ["control", "ctrl"],
  ["alt", "alt"],
  ["option", "alt"],
  ["shift", "shift"],
  ["meta", "meta"],
  ["super", "meta"],
  ["win", "meta"],
  ["windows", "meta"],
  ["cmd", "meta"],
  ["command", "meta"],
  ["fn", "fn"],
]);

const KEY_ALIASES = new Map<string, string>([
  ["enter", "enter"],
  ["return", "enter"],
  ["space", "space"],
  ["spacebar", "space"],
  ["tab", "tab"],
  ["esc", "escape"],
  ["escape", "escape"],
  ["backspace", "backspace"],
  ["delete", "delete"],
  ["del", "delete"],
  ["forwarddelete", "delete"],
  ["fwddelete", "delete"],
  ["home", "home"],
  ["end", "end"],
  ["pageup", "pageup"],
  ["pgup", "pageup"],
  ["pagedown", "pagedown"],
  ["pgdn", "pagedown"],
  ["up", "up"],
  ["arrowup", "up"],
  ["down", "down"],
  ["arrowdown", "down"],
  ["left", "left"],
  ["arrowleft", "left"],
  ["right", "right"],
  ["arrowright", "right"],
]);

function sanitizeKeyToken(token: string): string {
  return token.trim().toLowerCase().replace(/[_-]+/g, "");
}

function normalizeChordPart(
  part: string,
): { kind: "modifier" | "key"; value: string } | null {
  const raw = part.trim();
  if (!raw) return null;

  const sanitized = sanitizeKeyToken(raw);
  const modifier = MODIFIER_ALIASES.get(sanitized);
  if (modifier) {
    return { kind: "modifier", value: modifier };
  }

  const key = KEY_ALIASES.get(sanitized);
  if (key) {
    return { kind: "key", value: key };
  }

  if (/^f\d{1,2}$/i.test(sanitized)) {
    return { kind: "key", value: sanitized.toLowerCase() };
  }

  if (raw.length === 1) {
    return { kind: "key", value: raw.toLowerCase() };
  }

  return { kind: "key", value: raw };
}

export function normalizeKeyCombo(keyCombo: string): CanonicalKeyChord[] {
  return keyCombo
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((rawChord) => {
      const modifiers: CanonicalModifier[] = [];
      const keys: string[] = [];

      for (const rawPart of rawChord.split("+")) {
        const part = normalizeChordPart(rawPart);
        if (!part) continue;

        if (part.kind === "modifier") {
          if (!modifiers.includes(part.value as CanonicalModifier)) {
            modifiers.push(part.value as CanonicalModifier);
          }
          continue;
        }

        keys.push(part.value);
      }

      return { modifiers, keys };
    })
    .filter((chord) => chord.modifiers.length > 0 || chord.keys.length > 0);
}

export function canonicalizeKeyCombo(keyCombo: string): string {
  return normalizeKeyCombo(keyCombo)
    .map((chord) => [...chord.modifiers, ...chord.keys].join("+"))
    .join(" ");
}

export function toLinuxKeyToken(key: string): string {
  switch (key) {
    case "enter":
      return "Return";
    case "tab":
      return "Tab";
    case "escape":
      return "Escape";
    case "backspace":
      return "BackSpace";
    case "delete":
      return "Delete";
    case "space":
      return "space";
    case "up":
      return "Up";
    case "down":
      return "Down";
    case "left":
      return "Left";
    case "right":
      return "Right";
    case "home":
      return "Home";
    case "end":
      return "End";
    case "pageup":
      return "Page_Up";
    case "pagedown":
      return "Page_Down";
    case "meta":
      return "super";
    default:
      if (/^f\d{1,2}$/i.test(key)) {
        return key.toUpperCase();
      }
      return key;
  }
}
