// Subscribers fire on rotate so shellWrapper can push the new key into
// the running shell's stdin; other consumers sample lazily via getKey().
export function createNaisysApiService(initialKey?: string) {
  let current = initialKey;
  const subscribers: Array<(newKey: string) => void> = [];

  return {
    getKey: () => current,
    rotateKey: (newKey: string) => {
      current = newKey;
      for (const cb of subscribers) cb(newKey);
    },
    onChange: (cb: (newKey: string) => void) => {
      subscribers.push(cb);
    },
  };
}

export type NaisysApiService = ReturnType<typeof createNaisysApiService>;
