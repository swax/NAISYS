import { config } from "zod";

// Disable Zod v4 JIT (uses `new Function`) to comply with CSP script-src 'self'.
// Mutates Zod's captured globalConfig in place — must run before any module
// constructs a schema, since allowsEval is probed at schema-init time. Importing
// this file first in main.tsx guarantees it runs before App's transitive imports.
config({ jitless: true });
