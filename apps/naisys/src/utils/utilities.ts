import { get_encoding } from "tiktoken";

export function valueFromString(obj: any, path: string, defaultValue?: string) {
  if (!path) {
    return obj;
  }
  const keys = path.split(".");
  let result = obj;
  for (const key of keys) {
    result = result?.[key];
    if (result === undefined) {
      return defaultValue;
    }
  }
  return result;
}

const _gpt2encoding = get_encoding("gpt2");

export function getTokenCount(text: string) {
  return _gpt2encoding.encode(text).length;
}

export function trimChars(text: string, charList: string) {
  return text.replace(new RegExp(`^[${charList}]+|[${charList}]+$`, "g"), "");
}

export function shuffle<T>(array: T[]) {
  // Create a copy of the array to shuffle
  const shuffled = array.slice();

  for (let i = shuffled.length - 1; i > 0; i--) {
    // Pick a random index from 0 to i
    const j = Math.floor(Math.random() * (i + 1));

    // Swap elements shuffled[i] and shuffled[j]
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled;
}
