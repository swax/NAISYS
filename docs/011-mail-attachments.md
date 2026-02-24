# Attachment Support

## Goal

Allow agents to share files with each other via `ns-mail` and `ns-chat`, and to attach files to run context logs. Files are uploaded/downloaded over HTTP on the hub's HTTPS server, with only attachment metadata sent over Socket.IO alongside messages.

## Design

### Upload flow (mail/chat)

1. Agent runs `ns-mail send "bob" "subject" "msg" /path/file1.txt` or `ns-chat send "bob" "msg" /path/file1.txt`
2. The NAISYS client reads each file, computes its SHA-256 hash, and POSTs the file body to the hub's `/attachments` HTTP endpoint with query params for auth, filename, size, hash, and purpose.
3. The hub validates the API key, streams the file to disk under `NAISYS_FOLDER/attachments/<date>/`, verifies the hash, creates an `attachments` database record (with `purpose = "mail"`), and returns the attachment ID.
4. The client sends the `MAIL_SEND` Socket.IO event with the list of `attachmentIds`.
5. The hub creates `mail_attachments` join records linking each attachment to the newly created message.

### Download flow

When a recipient reads a message containing attachments, the display includes a curl command per attachment:

```
curl -k "<hubUrl>/attachments/<id>?apiKey=$NAISYS_API_KEY" -o <filename>
```

The `$NAISYS_API_KEY` environment variable is already available in every agent's shell, so the agent can run the command directly.

### HTTP endpoints

Both endpoints live on the hub's existing HTTPS server, registered as a raw `request` handler that checks the pathname before Socket.IO processes the request.

**POST `/attachments?apiKey=...&filename=...&filesize=...&filehash=...&purpose=...`** — Upload a file. Body is the raw file content. `purpose` is `"mail"` or `"context"`. Returns `{ id }`. 10 MB size limit.

**GET `/attachments/<id>?apiKey=...`** — Download a file. Streams the file with `Content-Disposition: attachment`.

### Authentication

Both endpoints authenticate using the per-user `api_key` from the `users` table (the same value exposed as `NAISYS_API_KEY` in the agent's shell environment). The hub looks up the user by API key — no user ID is needed in the request.

### Storage

Files are stored on disk at `NAISYS_FOLDER/attachments/<YYYY-MM-DD>/<timestamp>_<userId>_<safeFilename>`. The full path is recorded in the `attachments` database record.

### Database

The `attachments` table tracks each uploaded file:

- `id` — autoincrement primary key
- `filepath` — server-side storage path
- `filename` — original filename
- `file_size`, `file_hash` — size in bytes and SHA-256 hex digest
- `purpose` — `"mail"` or `"context"`
- `uploaded_by` — FK to `users`
- `created_at`

The `mail_attachments` join table links attachments to mail messages:

- `message_id` — FK to `mail_messages`
- `attachment_id` — FK to `attachments`
- Composite primary key on `(message_id, attachment_id)`

Context log attachments are linked directly via `context_log.attachment_id` (nullable FK to `attachments`).

### Client architecture

The upload logic (file resolution, hashing, HTTP POST) lives in a shared `attachmentService` that is used by both mail/chat commands and context log uploads. The service accepts a `purpose` parameter to distinguish between attachment types.

### Protocol changes

- `MailSendRequest` gained an optional `attachmentIds: number[]` field
- `MailMessageData` gained an optional `attachments` array with `{ id, filename, fileSize }` per attachment
- MAIL_PEEK and MAIL_UNREAD responses include attachment metadata when present
