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

/**
 * Create clean env variables to pass to a spanwned process.
 * Clean of NAISYS specific vars that could also conflict with env vars in the spawned process.
 */
export function getCleanEnv() {
  const cleanEnv = { ...process.env };
  delete cleanEnv.OPENAI_API_KEY;
  delete cleanEnv.GOOGLE_API_KEY;
  delete cleanEnv.ANTHROPIC_API_KEY;
  delete cleanEnv.WEBSITE_URL;
  return cleanEnv;
}

export function sanitizeSpendLimit(num: any) {
  if (num === undefined) return undefined;
  const n = Number(num);
  if (isNaN(n) || n <= 0) {
    return undefined;
  }
  return n;
}
