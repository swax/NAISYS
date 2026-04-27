# Attachment Support

## Goal

Allow agents to share files with each other via `ns-mail` and `ns-chat`, and to attach files to run context logs. Files are uploaded and downloaded over HTTP on the hub's Fastify server, and only attachment metadata travels over Socket.IO alongside messages.

## Design

### Upload flow (mail/chat)

1. Agent runs `ns-mail send "bob" "subject" "msg" /path/file1.txt [file2 ...]` or `ns-chat send "bob" "msg" /path/file1.txt [...]`. File paths are argv[4+] for mail and argv[3+] for chat.
2. The NAISYS client resolves each path to an absolute path via `shellWrapper.resolvePaths()`, reads the file, and computes its SHA-256 hash.
3. The client POSTs the raw file bytes to the hub's `/attachments` endpoint with the `Authorization: Bearer <NAISYS_API_KEY>` header and query params `filename`, `filesize`, `filehash`, and `purpose`.
4. The hub validates the API key, streams the body to a temp file, verifies size and hash, moves the file into content-addressable storage, creates an `attachments` DB record, and responds with `{ id }` (the numeric primary key).
5. The client then emits `MAIL_SEND` over Socket.IO with an `attachmentIds: number[]` field.
6. On delivery, the hub creates `mail_attachments` join rows linking each attachment to the newly created message.

In **local mode** (no hub), the client skips the upload entirely — file paths flow through `MailContent.filePaths` and are rendered inline in the notification.

### Download flow

When a recipient reads a message containing attachments, the display includes a ready-to-run curl command per attachment:

```
curl -H "Authorization: Bearer $NAISYS_API_KEY" "<hubUrl>/attachments/<publicId>" -o <filename>
```

`$NAISYS_API_KEY` is already set in every agent's shell environment, so the agent runs the command directly. The `<publicId>` shown here is the attachment's short `public_id` string (10-char base64url), not the numeric database ID.

### HTTP endpoints

The routes are registered as regular Fastify handlers on the hub's existing HTTPS server under the `/hub` base path. Because the client's configured `hubUrl` already includes `/hub`, client code hits `${hubUrl}/attachments`, which resolves server-side to `/hub/attachments`.

**POST `/hub/attachments?filename=...&filesize=...&filehash=...&purpose=...`** — Upload a file.

- Auth: `Authorization: Bearer <apiKey>` header.
- `purpose` must be `"mail"` or `"context"`.
- Body: raw file bytes. Fastify's default body parsing is disabled for this route so the body streams directly to disk.
- Size limit: 10 MB. Exceeding it mid-upload returns 413.
- The server hashes while writing, then compares against the `filehash` query param; a mismatch returns 400 and the temp file is deleted.
- Returns `{ id: number }` — the numeric `attachments.id` primary key, which the client passes back in `MAIL_SEND`.

**GET `/hub/attachments/:publicId`** and **GET `/hub/attachments/:publicId/:filename`** — Download a file.

- Auth: `Authorization: Bearer <apiKey>` header.
- The optional trailing `:filename` segment is accepted for friendly URLs but ignored for lookup; the file is always found by `public_id`.
- Content-Type is inferred from the stored filename (via `mimeFromFilename`). Content-Disposition is `inline` for images and `attachment` otherwise; Content-Length is set from `fs.statSync`.
- 404 if the record doesn't exist or the on-disk file is missing.

### Authentication

Both endpoints extract the bearer token via `extractBearerToken()` and look up the user with `hubDb.users.findUnique({ where: { api_key: apiKey } })`. A missing or unknown key returns 401. There is no separate user ID in the request — the API key identifies the uploader and is recorded as `uploaded_by`. The same key is exposed to agents as the `NAISYS_API_KEY` environment variable.

### Storage

Files are stored **content-addressably** by their SHA-256 hash:

```
NAISYS_FOLDER/attachments/hub/<hash[0:2]>/<hash[2:4]>/<fullhash>
```

Uploads first land in `NAISYS_FOLDER/tmp/hub/attachments/<timestamp>_<userId>_<rand>`, and are only moved to the final path after the hash check passes. If the target path already exists (another upload produced the same bytes), the temp file is discarded so identical files share storage. The resolved path is recorded in `attachments.filepath`.

### Database

The `attachments` table (`packages/hub-database/prisma/schema.prisma`):

- `id` — autoincrement integer primary key; internal only, used in the `MAIL_SEND` request.
- `public_id` — unique 10-char base64url string generated with `randomBytes(8).toString("base64url").slice(0, 10)`. This is the identifier exposed to clients in download URLs and message metadata.
- `filepath` — absolute path to the content-addressed file on disk.
- `filename` — original filename.
- `file_size`, `file_hash` — size in bytes and SHA-256 hex digest.
- `purpose` — enum `AttachmentPurpose` with values `"mail"` and `"context"`.
- `uploaded_by` — FK to `users.id`.
- `created_at`.

The `mail_attachments` join table links attachments to mail messages:

- `message_id` — FK to `mail_messages.id`.
- `attachment_id` — FK to `attachments.id`.
- Composite primary key on `(message_id, attachment_id)`.
- `created_at`.

Context log attachments are linked directly: `context_log.attachment_id` is a nullable FK to `attachments.id` (ON DELETE SET NULL). Each context log row has at most one attachment.

### Client architecture

The upload logic lives in `apps/naisys/src/services/attachmentService.ts` as a factory `createAttachmentService(hubClient, userService, localUserId)` that exposes:

- `upload(filepath, purpose): Promise<number>` — reads the file, hashes it, POSTs it, and returns the numeric attachment ID. Throws if there's no hub client (local mode) or no API key.
- `uploadAll(filepaths, purpose): Promise<number[]>` — sequentially uploads a list and returns the IDs.

Both `ns-mail send` and `ns-chat send` call `uploadAll(..., "mail")`. Context log uploads go through the same service with `purpose = "context"`.

### Context log attachments

Log writers don't block on uploads. `hubLogBuffer` supports a per-entry `resolveAttachment?: () => Promise<number | undefined>`; the buffer awaits these resolvers before flushing, and an upload failure just drops the attachment rather than losing the log line. The resolved numeric ID is sent over the `LOG_WRITE` protocol as `LogWriteEntry.attachmentId`. On the hub, `hubLogService` rewrites that to `public_id`, `filename`, and `file_size` fields on the outbound `LogPushEntry` so supervisors see the public identifier.

### Protocol changes

Shared schemas live in `packages/hub-protocol/src/schemas/`:

- **`MailSendRequest`** (`mail.ts`) gained an optional `attachmentIds: number[]` — numeric DB IDs returned from the upload endpoint.
- **`MailAttachmentData`** — `{ id: string; filename: string; fileSize: number }`. The `id` here is the `public_id`, not the numeric PK.
- **`MailMessageData`** and **`MailListMessageData`** gained an optional `attachments: MailAttachmentData[]`. MAIL_PEEK and MAIL_UNREAD responses carry attachment metadata when present, and the supervisor `MAIL_PUSH` event includes the same.
- **`LogWriteEntry`** (`logs.ts`) gained an optional numeric `attachmentId`; **`LogPushEntry`** carries the resolved `attachmentId` (public_id string), `attachmentFilename`, and `attachmentFileSize`.

Chat uses the same transport — `ns-chat` send is delivered through `MAIL_SEND` with `kind: "chat"` and reuses `purpose = "mail"` for its attachments.
