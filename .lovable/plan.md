
# Speed & navigation pass

Goal: moving between pages feels instant. No loading spinner flicker on data you already have. Heavy pages don't block the rest of the app. Same calm UI, just quicker.

## Current state (what's already good)
- Router: `defaultPreload: "intent"`, `defaultPreloadStaleTime: 0`, `scrollRestoration: true`.
- TanStack Query defaults: `staleTime: 60s`, `gcTime: 10m`, no refetch on focus.
- Sidebar uses `<Link>` (preloads on hover).

## What's slowing things down
1. **Every page re-fetches on mount.** Almost all routes use `useQuery` in the component (no loader prefetch). Hover-preload helps only if you hover; tapping a nav item still shows a spinner while the first fetch runs.
2. **Shared lists are re-fetched per page.** `businesses`, `folders`, `lists`, `calendars`, `outcomes` are queried in nearly every route. With `staleTime: 60s` they're cached, but they're not seeded on app boot, so the first navigation to each page pays the round-trip.
3. **Huge route chunks.** `calendar.tsx` ~3k lines, `tasks.tsx` ~2.4k lines, `admin.users.$userId.tsx` ~1k, `admin.index.tsx` ~730. These ship as single JS chunks on first visit.
4. **Spinner flicker on cached data.** Many pages render `isLoading ? <Spinner/> : <Content/>` even when cached data exists, causing a flash between navigations.
5. **Mic / floating buttons + heavy panels** (assistant, command palette, notification center) are imported eagerly even when never opened.
6. **Images** (welcome poster, branding) aren't preloaded for their owning routes and aren't size-hinted for AVIF/WebP.

## Plan (small, ordered, low-risk)

### Phase 1 — Instant navigation (biggest win, smallest change)
- **Seed shared lists on app boot.** In `_authenticated/route.tsx`, on the first authenticated render, `queryClient.prefetchQuery` for `businesses`, `folders`, `lists`, `calendars`, `outcomes`. After boot, every nav into Tasks / Calendar / Plan / Today / Notes finds these warm. Total cost: one parallel burst at sign-in, then silence.
- **Use cached data while refetching** instead of spinner-flash. Replace `isLoading ? Spinner : Content` with "render last data + subtle top progress" on the 8 most-visited pages (Today, Tasks, Calendar, Plan-week, Notes, Outcomes, Inbox, Learn). Concretely: render content whenever `data` exists, show the spinner only on true cold loads (`isPending && !data`).
- **Bump preload aggressiveness for the sidebar.** Set `preload="intent"` and `preloadDelay: 30` on primary nav links so hover/tap-start fires the loader earlier.

### Phase 2 — Lighter chunks
- **Lazy-load secondary panels** (`assistant-panel`, `command-palette`, `notification-center`, `talk-button` recorder, `focus-mode`, `topup-dialog`) via `React.lazy` + `<Suspense fallback={null}>`. They open on demand, so the initial bundle drops.
- **Code-split the biggest routes** by extracting non-default views into their own lazy modules:
  - `calendar.tsx`: split month / week / day / agenda render trees + the `event-popover` editor.
  - `tasks.tsx`: split timeline view, stage manager, and the task-detail drawer.
  - `admin.*`: keep each admin tab as its own already-split route; verify nothing imports across.
  No behavior change, just `lazy()` boundaries.
- **Remove eager admin imports from the main bundle** for non-admin users (already on separate routes — audit `app-shell` to confirm nothing forces them in).

### Phase 3 — Loader-prefetch the high-traffic routes
- For Today, Tasks, Calendar, Plan-week, Notes, Outcomes: add a minimal `loader: ({ context }) => { context.queryClient.ensureQueryData(...) }` that primes the page's primary query. Combined with `defaultPreload: "intent"`, this means: hover (or sidebar tap) starts the fetch *before* the component mounts, so by the time the route renders, data is usually ready. Component still uses `useQuery` so revalidation continues normally.

### Phase 4 — Asset & paint polish
- **Preload the welcome poster** on `/learn` via per-route `head().links` (`rel=preload, as=image, fetchpriority=high`) — only on that route, not globally.
- **Convert bundled hero/poster JPGs to WebP** at build time with `vite-imagetools` (`?format=webp`), keep the JPG as fallback.
- **Add `loading="lazy"` and explicit `width`/`height`** to non-LCP images across cards (notes thumbs, calendar avatars) to stop layout shift.
- **Defer `error-capture` + analytics flush** to `requestIdleCallback` so they don't compete with first paint.

### Phase 5 — Measurement (so we can prove it)
- Use Playwright to record nav timing before/after for: sign-in → Today, Today → Tasks, Tasks → Calendar, Calendar → Notes. Capture First Contentful Paint and "time until primary list visible".
- Spot-check Lighthouse Performance on `/today` and `/calendar` after Phase 2.

## Out of scope (won't touch this pass)
- Server-side / Supabase query tuning (separate review — say the word and I'll run `slow_queries` + add indexes).
- Visual redesign or copy changes.
- Tour engine, onboarding flow, AI logic.

## Order I'd ship
Phase 1 first (90% of the perceived-speed win in one change). Then 2, then 3. 4 and 5 are polish + proof.

Reply "go" to implement Phase 1, or tell me which phases to bundle.
