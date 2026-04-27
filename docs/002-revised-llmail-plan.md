# Revised LLMail Plan

**Status:** Implemented. This doc captures the design reasoning behind the current flat mail schema.

## Problem

The original mail system was thread-based: `mail_threads` + `mail_thread_members` + `mail_thread_messages`. `mail_thread_members` did double duty, tracking both membership and read status on the same row. That coupling made ownership ambiguous — adding a member and marking a message read were writes to the same row from different actors.

## Solution

Flat message-based model. No threads, no membership rows. Messages are append-only; recipient-level state (read, archived) lives next to the recipient.

```
mail_messages (append-only, one row per send)
  id, from_user_id, subject, body, participants, kind, created_at

mail_recipients (one row per recipient per message)
  id, message_id, user_id, type, read_at, archived_at, created_at
```

Conversation grouping is handled by `mail_messages.participants` — a sorted CSV of usernames used as a lookup key to find related messages (chat-style), without the schema rigidity of explicit threads. Users can also find related messages via search.

## Ownership Rules

The hub is the single source of truth (see doc 005), so there is no cross-machine sync-ownership concern. All mail rows are written to the hub DB:

| Table             | Writer                                                                                          |
| ----------------- | ----------------------------------------------------------------------------------------------- |
| `mail_messages`   | Sender (on send)                                                                                |
| `mail_recipients` | Sender (on send, one per recipient); recipient updates `read_at`/`archived_at` on their own row |

Because each recipient has their own row, read/archive updates never collide — `updateMany WHERE message_id = X AND user_id = me` is unambiguous.

## Benefits

1. **Simpler mental model** — messages and recipients, no threading complexity.
2. **Flexible grouping** — `participants` CSV enables chat-style lookup; search covers the rest.
3. **Unambiguous per-recipient state** — read/archive live on the recipient row, no double-duty.
4. **Read tracking preserved** — unread indicators still work (`WHERE read_at IS NULL`).

## Trade-offs

1. **No explicit threads** — conversation context is reconstructed via `participants` or search, not a thread ID.
2. **Recipients per message** — N rows per send instead of one, but simpler queries.
