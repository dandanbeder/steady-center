# Microsoft / Outlook Calendar Integration

Mirrors the existing Google Calendar sync. Same `calendars` + `events` tables, same UI patterns, same sync-status badges. Nothing about Google sync changes.

## 1. Entra app registration (you do this)

**Redirect URI to register in Entra (Web platform):**

```
https://www.heartbeatcommand.software/auth/microsoft/callback
```

Also add (for preview + lovable subdomain):
```
https://heartbeatcommand.software/auth/microsoft/callback
https://steady-center.lovable.app/auth/microsoft/callback
```

- Supported account types: **Accounts in any organizational directory and personal Microsoft accounts** (multi-tenant + personal — `/common` authority).
- API permissions (delegated): `Calendars.ReadWrite`, `offline_access`, `openid`, `email`, `profile`.
- Create a client secret → give me the values via the secrets prompt.

I'll request `MS_CLIENT_ID` and `MS_CLIENT_SECRET` after you approve this plan.

## 2. Database (migration)

- New table `ms_oauth_tokens` (server-side only, RLS denies all to authenticated):
  - `user_id uuid PK`, `access_token text`, `refresh_token text`, `expires_at timestamptz`, `account_email text`, `scope text`, `tenant_id text`, `created_at`, `updated_at`.
  - GRANT only to `service_role`. No `authenticated` grant — tokens never reach the client.
- New table `ms_subscriptions` for Graph change-notification subscriptions:
  - `id uuid PK`, `user_id`, `calendar_id` (FK → calendars), `subscription_id text` (Graph id), `client_state text`, `expires_at timestamptz`, `created_at`. RLS: service_role only.
- Extend `calendars`: nothing new — `provider='microsoft'`, `external_id` = Graph calendar id, existing `sync_token` reused as Graph delta link.
- Extend `events`: nothing new — `source='microsoft'`, `external_id` = Graph event id.
- pg_cron: hourly sync + 12-hourly subscription renewal calling new public routes.

## 3. Server functions — `src/lib/microsoft-calendar.functions.ts`

Pattern mirrors `google-calendar.functions.ts`. All gated by `requireSupabaseAuth`. Token helpers (`getValidAccessToken(userId)`) live in `microsoft-calendar.server.ts` and refresh tokens automatically using `refresh_token` when within 5 min of expiry.

- `startMicrosoftOAuth()` → returns Microsoft authorize URL with `state` (signed, contains userId + nonce) and PKCE.
- `listRemoteMicrosoftCalendars()` → `GET /me/calendars` via Graph.
- `importMicrosoftCalendar({ external_id, name, color, business_id })` → inserts row in `calendars` with `provider='microsoft'`, kicks off initial delta sync, registers Graph subscription.
- `syncMicrosoftCalendarNow({ calendar_id })` → delta query: `GET /me/calendars/{id}/calendarView/delta` (or stored `@odata.deltaLink`). Stores new delta link in `calendars.sync_token`. Upserts events keyed on `(calendar_id, external_id)` — same de-dupe behavior as Google. Handles recurrence (uses calendarView so series instances are expanded), all-day (`isAllDay`), timezones (`start.timeZone` / `end.timeZone`).
- `pushEventToMicrosoft({ event_id })` and `deleteEventInMicrosoft({ event_id })` — mirror Google counterparts; called from `src/lib/calendars.ts`.
- `disconnectMicrosoft({ remove_events })` → deletes tokens, subscriptions, optionally events with `source='microsoft'`, and marks calendars.

## 4. Wire into existing helpers

`src/lib/calendars.ts` `maybePushToGoogle()` becomes provider-aware (`maybePushToProvider()`): if `provider === 'microsoft'` route to MS push/delete. Same `sync_status` lifecycle (`pending` / `synced` / `failed`). Same warning string format with "Reconnect Microsoft in Settings › Connections" on 401.

## 5. Public routes

- `src/routes/auth/microsoft/callback.tsx` — handles OAuth code → exchanges for tokens → stores via server fn → closes popup / redirects to `/settings`.
- `src/routes/api/public/hooks/sync-microsoft-calendars.ts` — hourly cron: iterates all `calendars` with `provider='microsoft'`, runs delta sync.
- `src/routes/api/public/hooks/renew-microsoft-subscriptions.ts` — runs every 12h: renews any `ms_subscriptions` expiring within 24h.
- `src/routes/api/public/hooks/microsoft-graph-webhook.ts` — receives Graph change notifications. Validates `clientState`, returns `validationToken` plaintext on initial handshake, otherwise enqueues a delta sync for affected calendars.

All hook routes use the existing `x-cron-secret` / `apikey` pattern.

## 6. UI

- `src/components/microsoft-sync-panel.tsx` — clone of `GoogleSyncPanel`: "Connect Outlook" button (opens OAuth popup) → after connect, lists remote calendars with Import + business assignment + colour picker; per-synced-calendar Sync Now / Disconnect; shows account email + last_synced_at; "Reconnect Microsoft" state when token revoked.
- `src/routes/_authenticated/settings.tsx` — replace disabled Microsoft card with `<MicrosoftSyncPanel />`. Google panel untouched.
- Sync status badges already provider-agnostic — reused as-is.

## 7. Safety & verification

- RLS verified: `ms_oauth_tokens` + `ms_subscriptions` deny all access from `authenticated`; only server-side service-role queries reach them.
- Google sync paths untouched — provider check is additive (`=== 'google'` branch preserved).
- 401/invalid_grant from Graph → marks tokens as needing reconnect and surfaces in UI.
- Webhook signature: validates `clientState` matches stored value per subscription.

## Files

**Migration**
- Create `ms_oauth_tokens`, `ms_subscriptions` (+ grants + RLS deny-all to authenticated)
- pg_cron: hourly sync + 12-hourly subscription renewal

**New**
- `src/lib/microsoft-calendar.functions.ts`
- `src/lib/microsoft-calendar.server.ts` (token refresh, Graph fetch helper)
- `src/components/microsoft-sync-panel.tsx`
- `src/routes/auth/microsoft/callback.tsx`
- `src/routes/api/public/hooks/sync-microsoft-calendars.ts`
- `src/routes/api/public/hooks/renew-microsoft-subscriptions.ts`
- `src/routes/api/public/hooks/microsoft-graph-webhook.ts`

**Edited**
- `src/lib/calendars.ts` — `maybePushToProvider()` dispatches to Google or Microsoft
- `src/routes/_authenticated/settings.tsx` — activate Microsoft card

**Secrets requested after approval**
- `MS_CLIENT_ID`
- `MS_CLIENT_SECRET`
- (existing `CRON_SECRET` reused)
