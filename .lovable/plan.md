# Refine sharing: invite → sign-up → request-access → approve

## Goal

Replace today's "invite directly creates a pending membership" model with an explicit four-step flow:

1. Admin **invites** by email → row in `invitations` (status `sent`) + Resend email with link to sign up.
2. Invitee **signs up** for their own account (normal email/password or Google).
3. After login, app **matches their email to invitations** and shows "You've been invited to <Account>". They click **Request access** → row in `access_requests` (status `pending`).
4. Owner/admin sees pending requests in the People panel and **Approves** (confirming the role) or **Denies**. On approve: insert an **active membership** with that role, mark the invitation `accepted`, and email the requester.

Until approval, the requester has **zero** access to the Account's data — enforced by RLS, not just UI.

## Schema (Migration 1)

New tables:

- `public.invitations`
  - `id uuid pk`, `business_id uuid not null`, `invited_email citext not null`, `proposed_role membership_role not null` (must be in admin/member/commenter/viewer — owner blocked by check), `invited_by uuid not null`, `token uuid not null unique default gen_random_uuid()`, `status text not null default 'sent' check in ('sent','accepted','revoked','expired')`, `created_at timestamptz default now()`, `expires_at timestamptz default now() + interval '14 days'`.
  - Indexes on `(business_id, status)`, `(lower(invited_email), status)`, `(token)`.
- `public.access_requests`
  - `id uuid pk`, `business_id uuid not null`, `requester_user_id uuid not null`, `invitation_id uuid null` (when triggered from an invite), `message text`, `status text not null default 'pending' check in ('pending','approved','denied')`, `created_at timestamptz default now()`, `decided_by uuid`, `decided_at timestamptz`, `proposed_role membership_role not null`.
  - Unique partial index: one open request per `(business_id, requester_user_id) where status='pending'`.

GRANTs for both: `select,insert,update,delete` to `authenticated`; `all` to `service_role`. No `anon`.

### RLS

`invitations`:
- SELECT: `invited_by = auth.uid() OR is_member(business_id,'admin') OR is_platform_admin() OR lower(invited_email) = lower((select email from auth.users where id = auth.uid()))` (so the invitee can see their own invite).
- INSERT/UPDATE/DELETE: `is_member(business_id,'admin') OR is_platform_admin()` (write goes through server fns w/ admin client, but keep RLS tight).

`access_requests`:
- SELECT: `requester_user_id = auth.uid() OR is_member(business_id,'admin') OR is_platform_admin()`.
- INSERT (caller creating own request): `requester_user_id = auth.uid()` AND not already an active member.
- UPDATE (approve/deny): `is_member(business_id,'admin') OR is_platform_admin()`.
- DELETE: admin-only or owner of the request.

`memberships` (already correct): keep as-is — active memberships are only created server-side on approval.

### Migration 2 — cleanup legacy invite rows

- Backfill: convert existing `memberships` rows with `status='invited'` into `invitations` rows (status `sent`, copy email/role/token/expiry), then delete those memberships.
- Drop `claim_pending_invites` trigger on `auth.users` (it auto-claimed invited memberships; no longer the flow). Also drop the `invite_token`/`invite_token_expires_at`/`invited_email` columns on `memberships` once data is migrated — keep memberships pure: only active memberships exist.

## Server functions (`src/lib/memberships.functions.ts` + new `invitations.functions.ts`)

Rewrite the existing functions:

- `inviteMember(business_id, email, role)` — admin+; **does NOT** create a membership. Creates an `invitations` row (or refreshes existing `sent` row's token), sends email. **Never reveals** whether the email already has an account — always returns `{ ok:true }`.
- `listInvitations(business_id)` — admin+; list invitations for the People panel.
- `revokeInvitation(id)` — admin+; sets status `revoked`.
- `resendInvitation(id)` — admin+; refresh token+expiry, re-send email.
- `listMyInvitations()` — signed-in user; returns invitations matching their email + business name. Used on the new "Invitations" landing/badge after login.
- `requestAccess({ invitation_token? | business_id })` — signed-in user; create `access_requests` row with `proposed_role` from invitation (or `viewer` if business-id only). If invitation exists, link via `invitation_id`. Idempotent: returns existing pending request.
- `listPendingRequests(business_id)` — admin+; lists access requests with requester profile info via `auth.users` lookup (admin client).
- `decideAccessRequest({ request_id, decision: 'approve'|'deny', role? })` — admin+. On approve: insert membership (active) with chosen role, mark invitation `accepted`, mark request `approved`, email requester. On deny: mark `denied`. Owner role only assignable by an owner.

All write functions go through `supabaseAdmin` after `requireRole` check.

## UI changes

- `src/components/people-panel.tsx`
  - Keep Members list (unchanged).
  - "Pending invites" → split into two sections:
    - **Invitations sent** (admin can resend / revoke; show email, role, sent date, status).
    - **Pending access requests** (admin: Approve / Deny buttons with role dropdown pre-filled to `proposed_role`).
  - Invite form unchanged but informs admin: "We'll email them a sign-up link. You'll approve their access after they sign up."
- Replace `src/routes/accept-invite.tsx` flow: the email link still goes to `/accept-invite?token=...` but the page now:
  - If signed out: prompt to sign up (link to `/login`) with banner "You've been invited to <space>".
  - If signed in: show the invitation, with a single **"Request access"** button. On click, call `requestAccess({ token })` → success screen "Request sent. The space owner will review shortly."
- New `src/components/my-invitations-banner.tsx`: shows on `/today` if `listMyInvitations()` returns any invitations the user hasn't requested yet. Quick CTA "Request access".
- Toast on admin People panel when new request arrives (polling on invalidate is fine; realtime out of scope).

## Email

Reuse the existing Resend helper. Add two more templates:
- Invite email (already exists, tweak copy: "Sign up to request access").
- Approval email: "You've been approved to join <space>" with link to `/today`.

## Security notes

- `inviteMember` always returns `{ ok: true }` and never errors on "email exists / already member" — log internally, swallow externally to avoid account enumeration.
- Rate limiting: per project directive (`no-backend-rate-limiting`), we **will not** add backend rate limiting. I'll call this out in the chat reply so the user knows it's intentional and tracked.
- All access-control checks happen in RLS first; server fns are a UX/error-handling layer over admin-client writes guarded by `requireRole`.

## Files touched

- `supabase/migrations/<ts>_invitations_and_access_requests.sql` (schema + RLS + GRANTs)
- `supabase/migrations/<ts>_migrate_invited_memberships.sql` (data backfill + drop legacy columns/trigger)
- `src/lib/invitations.functions.ts` (new)
- `src/lib/memberships.functions.ts` (trim — remove `inviteMember`, `acceptInvite`, `resendInvite` to invitations module; keep list/role/remove)
- `src/components/people-panel.tsx` (two sections + approval UI)
- `src/routes/accept-invite.tsx` (request-access flow)
- `src/components/my-invitations-banner.tsx` (new) + mount in `src/routes/_authenticated/today.tsx`
- `src/hooks/use-my-role.ts` (no change expected)

## Out of scope

- Realtime notifications (admins refresh / re-open panel to see new requests).
- Backend rate limiting (intentional — see Security notes).
- Bulk invite, CSV import.
- Audit log beyond the existing `admin_access_log`.
