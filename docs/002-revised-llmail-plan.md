# Revised LLMail Plan

## Problem

The current mail system uses `mail_thread_members` to track both membership AND read status. This creates a sync ownership conflict:

- Host A adds a member to a thread (owns the row)
- Host B updates `read_at` when that member reads it (needs to update the row)

This breaks the "sync only what you own" model needed for simple multi-machine sync.

## Solution

Replace the thread-based model with a flat message-based model. No threading, no read tracking - just messages with archive capability.

```
mail_messages (append-only, owned by sender)
  id              String    @id        // ULID
  from_user_id    String               // sender
  subject         String
  body            String
  created_at      DateTime  @default(now())

mail_recipients (append-only, owned by sender)
  id              String    @id        // ULID
  message_id      String               // FK to mail_messages
  user_id         String               // recipient
  type            String               // "to", "cc", "bcc"
  created_at      DateTime  @default(now())

mail_status (owned by recipient)
  id              String    @id        // ULID
  message_id      String               // FK to mail_messages
  user_id         String               // recipient
  read_at         DateTime?            // when first read (null = unread)
  archived_at     DateTime?            // when archived (null = inbox)
  created_at      DateTime  @default(now())
  updated_at      DateTime  @updatedAt

  @@unique([message_id, user_id])      // one status per message per user
```

## Ownership Rules

| Table             | Owner            | Sync Rule                                           |
| ----------------- | ---------------- | --------------------------------------------------- |
| `mail_messages`   | Sender's host    | Sync where `from_user.host_id = local_host`         |
| `mail_recipients` | Sender's host    | Sync where `message.from_user.host_id = local_host` |
| `mail_status`     | Recipient's host | Sync where `user.host_id = local_host`              |

Messages and recipients are append-only (ULID sync). Status is updatable (timestamp sync) but only by the owning host.

## Command Mapping

### `llmail help`

```
llmail <command>
  list                               List recent messages (non-archived, * = unread)
  read <id>                          Read a message (marks as read)
  send "<users>" "<subject>" "<msg>" Send a message
  archive <ids>                      Archive messages (comma-separated)
  search <terms> [-archived] [-subject] Search messages
  users                              List all users
  wait <seconds>                     Wait for new mail
```

### `llmail list`

Shows recent non-archived messages where user is sender or recipient. Marks unread.

```sql
SELECT
  m.id,
  m.subject,
  m.created_at,
  sender.username as from_user,
  GROUP_CONCAT(recipient.username) as to_users,
  CASE WHEN s.read_at IS NULL THEN '*' ELSE '' END as unread
FROM mail_messages m
JOIN users sender ON m.from_user_id = sender.id
JOIN mail_recipients r ON m.id = r.message_id
JOIN users recipient ON r.user_id = recipient.id
LEFT JOIN mail_status s ON m.id = s.message_id AND s.user_id = :myUserId
WHERE (s.archived_at IS NULL OR s.id IS NULL)
  AND (m.from_user_id = :myUserId OR r.user_id = :myUserId)
GROUP BY m.id
ORDER BY m.created_at DESC
LIMIT 20
```

### `llmail read <id>`

```
1. Display message (subject, from, to, body, date)
2. Upsert mail_status row (user_id = me, read_at = now if null)
```

### `llmail send "user1,user2" "subject" "message"`

```
1. Create mail_messages row (from_user_id = me)
2. Create mail_recipients rows for each recipient
3. Update user_notifications.latest_mail_id for recipients
```

### `llmail archive <ids>`

```
1. For each message id, upsert mail_status row (user_id = me, archived_at = now)
```

### `llmail search <terms> [-archived] [-subject]`

Search messages by text. Flags:

- `-archived` - include archived messages (default: exclude)
- `-subject` - search only in subject (default: search subject + body)

```sql
SELECT m.id, m.subject, m.body, m.created_at, sender.username
FROM mail_messages m
JOIN users sender ON m.from_user_id = sender.id
JOIN mail_recipients r ON m.id = r.message_id
LEFT JOIN mail_status s ON m.id = s.message_id AND s.user_id = :myUserId
WHERE (m.from_user_id = :myUserId OR r.user_id = :myUserId)
  AND (s.archived_at IS NULL OR s.id IS NULL OR :includeArchived)
  AND (
    m.subject LIKE :searchTerm
    OR (:searchBody AND m.body LIKE :searchTerm)
  )
ORDER BY m.created_at DESC
LIMIT 50
```

### `llmail users`

No change - lists all users.

### `llmail wait <seconds>`

No change - pauses until new mail arrives (checks for messages where user is recipient).

## Migration

### Schema Changes

```prisma
// Remove these tables
- mail_threads
- mail_thread_members
- mail_thread_messages

// Add these tables
+ mail_messages
+ mail_recipients
+ mail_status
```

### Data Migration

```sql
-- Create mail_messages from mail_thread_messages + mail_threads
INSERT INTO mail_messages (id, from_user_id, subject, body, created_at)
SELECT
  msg.id,
  msg.user_id,
  t.subject,
  msg.message,
  msg.date
FROM mail_thread_messages msg
JOIN mail_threads t ON msg.thread_id = t.id;

-- Create mail_recipients from mail_thread_members
INSERT INTO mail_recipients (id, message_id, user_id, type, created_at)
SELECT
  ulid(),
  msg.id,
  tm.user_id,
  'to',
  msg.date
FROM mail_thread_messages msg
JOIN mail_thread_members tm ON msg.thread_id = tm.thread_id;

-- Create mail_status from mail_thread_members
-- Combines read status (new_msg_id = '' means read) and archived status
INSERT INTO mail_status (id, message_id, user_id, read_at, archived_at, created_at, updated_at)
SELECT
  ulid(),
  msg.id,
  tm.user_id,
  CASE WHEN tm.new_msg_id = '' OR tm.new_msg_id < msg.id THEN NOW() ELSE NULL END,
  CASE WHEN tm.archived = 1 THEN NOW() ELSE NULL END,
  NOW(),
  NOW()
FROM mail_thread_messages msg
JOIN mail_thread_members tm ON msg.thread_id = tm.thread_id;
```

## Benefits

1. **Clean sync ownership** - Each table has single owner (sender or recipient)
2. **Minimal updates** - Only `mail_status` is updatable, and only by owner
3. **Simpler mental model** - No threading complexity, just messages
4. **Flexible search** - Users can find related messages via search instead of rigid threads
5. **No forwarding loops** - Owner is deterministic from the data itself
6. **Read tracking preserved** - Can still show unread indicators in list

## Trade-offs

1. **No threading** - Users manage conversation context themselves (or use search)
2. **Recipients per message** - Slightly more rows, but simpler model

## Simplification to Sync Plan

With this mail model, the sync plan simplifies significantly:

- No `updated_by` field needed on mail tables
- No joins through `updated_by` to determine ownership
- Ownership is direct: `from_user.host_id` for messages/recipients, `user.host_id` for status
- Messages/recipients are append-only (ULID sync)
- Status uses timestamp sync but is simple (one row per user per message, owned by user's host)
