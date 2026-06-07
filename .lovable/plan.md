# Full User Management for Super Admin

Expand `/admin` Users into a searchable list + per-user detail page with audited admin actions, server-side enforcement, and append-only audit log.

## 1. Database (migration)

### New table: `admin_audit_log` (append-only)
Columns: `id`, `admin_id`, `target_user_id`, `action` (text), `before` (jsonb), `after` (jsonb), `reason` (text), `created_at`.
- RLS: only `is_platform_admin()` can `SELECT`. INSERT/UPDATE/DELETE blocked for everyone (rows inserted via service_role in server fns).
- Trigger blocks any UPDATE/DELETE even from service_role to guarantee append-only.
- GRANT SELECT to authenticated, GRANT INSERT to service_role only.

### New table: `user_entitlement_overrides`
Columns: `id`, `user_id`, `key` (text, e.g. `ai_actions_extra`, `extra_businesses`), `value` (int), `expires_at` (nullable), `note`, `created_at`, `created_by`.
- RLS: superadmin SELECT/ALL; users can SELECT own.

### Profile additions
- `profiles.suspended_reason text`
- `profiles.suspended_message text` (shown on login)
- `profiles.deletion_scheduled_at timestamptz` (7-day soft delete)
- `profiles.deletion_requested_by uuid`

## 2. Server functions (`src/lib/admin.functions.ts`)

All gated by `requirePlatformAdmin()`. Each mutating fn writes to `admin_audit_log` with `before`/`after` and `reason`. Safety rails enforced server-side:
- No self-suspend, self-demote, self-delete.
- Last superadmin cannot be demoted/deleted (existing count check extended).
- Destructive actions require non-empty `reason` (already partly there) and explicit confirmation flags.

New/extended:
- `adminGetUser({user_id})` → profile + auth (email, last_sign_in, banned_until, email_confirmed_at) + subscription + overrides + recent audit entries.
- `adminUpdateProfile({user_id, patch, reason})` — name, organisation, role_title, phone, timezone.
- `adminChangeUserEmail({user_id, new_email, reason})` — typed-confirm checked client-side; server updates auth via `supabaseAdmin.auth.admin.updateUserById`, sends notice emails to old+new addresses via app email infra, logs.
- `adminResendVerification({user_id})` — uses `auth.admin.generateLink({type:'signup'})` or `inviteUserByEmail`.
- `adminManuallyVerifyEmail({user_id, reason})` — sets `email_confirm: true`.
- `adminSendPasswordReset({user_id})` — `auth.admin.generateLink({type:'recovery'})`, emails user.
- `adminRevokeSessions({user_id, reason})` — `auth.admin.signOut(user_id, 'global')`.
- `adminSuspendUser({user_id, reason, message})` — extends existing `adminSetUserStatus`, stores `suspended_reason`/`suspended_message`, bans in auth.
- `adminReactivateUser({user_id, reason})`.
- `adminUpsertEntitlementOverride({user_id, key, value, expires_at, note})`.
- `adminDeleteEntitlementOverride({id})`.
- `adminCompSubscription({user_id, plan, period_end, reason})` — inserts/updates a subscription row tagged as comp.
- `adminExtendTrial({user_id, days, reason})`.
- Extend `adminSetPlatformRole` to log via `admin_audit_log` (already partly).
- `adminScheduleUserDeletion({user_id, typed_email, reason})` — sets `deletion_scheduled_at = now()+7 days`, bans auth user, logs.
- `adminCancelUserDeletion({user_id, reason})`.
- `adminListAuditLog({target_user_id?, limit})`.

Cron route `/api/public/hooks/purge-deleted-users` (CRON_SECRET) deletes auth users + cascaded data where `deletion_scheduled_at < now()`.

## 3. Login enforcement

On sign-in (`src/routes/login.tsx`), if profile is `status='suspended'`, show the stored `suspended_message` (fallback: "Your account is suspended — contact support.") and immediately `signOut()`. (Auth ban already blocks tokens; this surfaces the message.)

## 4. UI

### `src/routes/_authenticated/admin.tsx` — UsersPanel rewrite
- Search box (name/email).
- Filters: plan, status, marketing opt-in, sign-up date range.
- Columns: user, email, plan, status, accounts owned, last active, marketing.
- Bulk select → Suspend / Export CSV.
- Row click → navigates to `/admin/users/$userId`.

### New route `src/routes/_authenticated/admin.users.$userId.tsx`
Sections (tabs/cards):
1. **Profile** — editable fields + Save dialog requiring reason.
2. **Email** — change email (typed-confirm + reason), Resend verification, Manually verify.
3. **Password & Sessions** — "Send password reset" + "Revoke all sessions" (no view/set password).
4. **Status** — Suspend (reason + optional user-facing message) / Reactivate.
5. **Plan & Billing** — current subscription, Comp, Extend trial, Adjust plan, Paddle customer link.
6. **Limit overrides** — list + add/remove with expiry.
7. **Role** — promote/demote.
8. **Danger zone** — Delete user (typed-email + reason, schedules 7-day purge; shows pending state + cancel).
9. **Audit log** — entries for this user.

Each destructive action uses a shared `ReasonConfirmDialog` component that requires a reason and (for destructive) typed confirmation token.

### `src/lib/admin.functions.ts` audit helper
Internal `logAudit(admin_id, target, action, before, after, reason)` used by every mutating fn.

## 5. Safety / Verification

- All `admin*` server fns: `requirePlatformAdmin(context.userId)` first.
- Self-action guards: throw on `target === admin` for suspend/demote/delete.
- Last-superadmin guard for demote/delete.
- `admin_audit_log` has a `BEFORE UPDATE OR DELETE` trigger raising exception (append-only).
- Confirm via Supabase linter after migration.

## Files

- migration: new tables, profile columns, trigger
- `src/lib/admin.functions.ts` — extend
- `src/routes/_authenticated/admin.tsx` — UsersPanel rewrite
- `src/routes/_authenticated/admin.users.$userId.tsx` — new detail page
- `src/components/admin/reason-confirm-dialog.tsx` — shared dialog
- `src/routes/login.tsx` — suspended-message surface
- `src/routes/api/public/hooks/purge-deleted-users.ts` — cron

After approval I'll run the migration and implement code in subsequent turns.
