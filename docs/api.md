# API reference

Base path: `/aubounty/api`. Error envelope on any failure: `{ error: { code, message, details? } }`. Prisma uniqueness violations surface as 409 CONFLICT, missing records as 404.

Authentication is the `aubounty_token` httpOnly cookie (see architecture.md). Endpoints marked **public** need no cookie. Endpoints marked **dev** exist only while `DEV_AUTH=1`.

## System

| Method and path | Auth | Purpose |
|---|---|---|
| GET `/health` | public | Liveness and version |
| GET `/meta` | public | Dev-auth flag, Entra availability, capability flags (maps, translation, weather, files) |

## Auth

| Method and path | Auth | Purpose |
|---|---|---|
| GET `/auth/login?returnTo=` | public | 302 to Microsoft. 503 when Entra is not configured |
| GET `/auth/callback` | public | OAuth code exchange, session cookie, 302 to the sanitized returnTo |
| GET `/auth/logout` | public | Clears the session cookie |
| POST `/auth/admin/login` | public | Email and password. Throttled 8 failures / 15 min per IP and per email (429 with Retry-After) |
| GET `/dev/users` | dev | User list for the dev sign-in picker |
| POST `/dev/advance-clock` | dev | Shifts the demo clock for settle rules |

## Tasks and events

| Method and path | Auth | Purpose |
|---|---|---|
| GET `/tasks` | public | Board feed. `?mine=true` and `?matches=true` narrow to the caller (empty list when anonymous), `?q=` searches |
| GET `/tasks/:id` | public | Task detail with assignments, attachments, review state |
| POST `/tasks` | session | Create. EVENT requires org membership plus TEACHER or ADMIN. EXTRA_CREDIT rewards require TEACHER or ADMIN. 1 to 3 tags. `orgId` and `type` are immutable after creation |
| PATCH `/tasks/:id` | session | Edit own post (admins any). Not on COMPLETED tasks |
| POST `/tasks/:id/cancel` | session | Cancel own non-completed post |
| POST `/tasks/:id/apply` | session | Take a seat. AUTO mode accepts instantly under a row lock; APPROVAL mode queues an application |
| GET `/tasks/:id/checkin-code` | session | Current 6-digit TOTP code plus remaining seconds. EVENT only. Poster, sponsoring org members, admins |
| POST `/tasks/:id/checkin` | session | Attendee submits the code. EVENT only. Throttled 5 wrong codes / 5 min (429). Completes the assignment |
| GET `/tasks/:id/calendar.ics` | session | RFC 5545 download. EVENT with dates only |
| POST `/tasks/:id/translate?lang=` | session | Title and content translation, identity fallback with `translated: false` when unkeyed |
| GET `/tags` | public | Curated tag list |

## Assignments

| Method and path | Auth | Purpose |
|---|---|---|
| POST `/assignments/:id/accept` | session | Poster accepts an application (row-locked occupancy check) |
| POST `/assignments/:id/reject` | session | Poster declines |
| POST `/assignments/:id/complete` | session | Taker marks work done, queues the confirmation email. Rejected for events |
| POST `/assignments/:id/confirm` | session | Poster confirms completion |
| POST `/assignments/:id/withdraw` | session | Taker withdraws |

## Messaging

| Method and path | Auth | Purpose |
|---|---|---|
| GET `/me/threads` | session | Inbox with last message and unread counts |
| GET `/assignments/:id/messages` | session | Thread history, cursor paginated (`?before=<messageId>&limit=` up to 100) |
| POST `/assignments/:id/messages` | session | Send (4000 char cap). Thread participants only |
| POST `/assignments/:id/read` | session | Mark the counterpart's messages read |

## Reviews

| Method and path | Auth | Purpose |
|---|---|---|
| POST `/reviews` | session | Create a sealed review, rating 1 to 5. Only a poster and a completed taker of the same non-event task, one per direction. Publishing waits for the double-blind window |

## Users

| Method and path | Auth | Purpose |
|---|---|---|
| GET `/me` | session | Own profile, orgs, tags, stats |
| PUT `/me` | session | Edit bio. `universityId` is settable exactly once |
| PUT `/me/tags` | session | Replace interest tags, max 8 |
| GET `/me/tasks` | session | Posted, taking, events, and the outstanding review queue |
| GET `/users/:id` | public | Public profile for share links. Only published reviews, hidden text shows as null but the rating still counts |

## Files

The API never proxies bytes. Both presign endpoints return 300 second URLs against the object store.

| Method and path | Auth | Purpose |
|---|---|---|
| POST `/files/presign` | session | Validate MIME (pdf, png, jpeg, webp, gif, txt, docx) and size (`MAX_UPLOAD_MB`), create the Attachment row, return a presigned PUT. Task attachments are poster-only, message attachments need thread participation |
| GET `/files/:id/url` | session | Presigned download link. Task attachments any signed-in user, message attachments participants only |
| DELETE `/files/:id` | session | Delete row and object. Uploader or admin |

## Admin

Every `/admin` route requires the ADMIN role.

| Method and path | Purpose |
|---|---|
| GET `/admin/users?q=&role=` | Directory search, excludes SERVICE accounts |
| PATCH `/admin/users/:id/role` | Change role. Not self, not SERVICE |
| GET `/admin/orgs` and GET `/admin/orgs/:id` | List and detail with members |
| POST `/admin/orgs` | Create organization |
| PATCH `/admin/orgs/:id` | Rename or redescription |
| POST `/admin/orgs/:id/members` | Add member with position |
| DELETE `/admin/orgs/:id/members/:userId` | Remove member |
| POST `/admin/tags` | Create curated tag |
| GET `/admin/reviews?hidden=&limit=` | Moderation queue, raw text visible |
| PATCH `/admin/reviews/:id/hide-text` | Hide or restore review wording. The rating keeps counting either way |

## Weather

| Method and path | Auth | Purpose |
|---|---|---|
| GET `/weather` | session | Current conditions for the configured campus point, cached 10 minutes |

## Realtime (socket.io)

Path `/aubounty/socket.io`, same origin and credentials as the API, authenticated at the handshake. Client emits `subscribe` / `unsubscribe` with `{ taskId }` or `{ assignmentId }`. Server emits `task:updated`, `emergency:new`, `message:new`, `message:read`.
