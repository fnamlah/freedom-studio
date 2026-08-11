# Freedom Studio — Deployment & Go-Live Handoff

This is the operator runbook to take Freedom Studio live. The database is
already provisioned; the remaining steps require dashboard access that only you
have (secret keys, Auth toggles), so they are documented here for you to run.

## What is already done (by the build)

- **Supabase project**: `freedom-studio` — ref `bcjdulqvaejosjstuieq`, region `ap-south-1`, Postgres 17.
  - URL: `https://bcjdulqvaejosjstuieq.supabase.co`
  - Migrations `001`–`012` applied (26 tables, RLS on every table, SECURITY INVOKER analytics, triggers, seeds).
  - Security advisors: **6 residual warnings**, all the RLS helper functions that must stay executable by `authenticated` for policy evaluation — safe by design (they expose only the caller's own session facts).
  - Edge functions deployed and ACTIVE: `share-view` (anonymous share links) and `bootstrap-admin` (one-time admin invite).
  - A **pending Super Admin invitation for `faisal@falconmind.co`** is already staged in the `invitations` table.
- **App**: full Next.js 15 build on `main` — every route typechecks and builds; the 9 redactor egress tests pass.
- **Runtime smoke test passed** (production server booted locally, Supabase deliberately unreachable):
  - Protected routes (`/dashboard`, `/ledger`, `/library`, `/admin/users`) all **307 → `/auth/login`** — auth **fails closed** when the backend is unreachable, rather than falling open.
  - `/api/ai/chat` and `/api/ai/classify` return **401** unauthenticated (never 200, never 500).
  - All security headers present, including a **unique per-request CSP nonce**, `frame-ancestors 'none'`, and `connect-src` scoped to this Supabase project only.
  - Zero errors or unhandled rejections in the server log.

## Step 0 — Deploy the app to Vercel (Git import)

**Everything is already on `main`** — importing the repo is all that's needed; no
branch configuration.

Why this and not an automated deploy: `api.vercel.com` is blocked by this
environment's egress proxy (403 on CONNECT), so neither the Vercel CLI nor the
REST API can reach Vercel from the build sandbox — a `VERCEL_TOKEN` would not
help. The Vercel MCP's only deploy tool uploads every file inline in a single
call (~184 files / 1.1 MB / ~344K tokens), far beyond the hard limit. Git import
is the correct transport for an app this size, and it gives you automatic
redeploys on every future push.

1. Vercel dashboard → **Add New… → Project → Import** `fnamlah/100-movies-to-watch` (or `freedom-studio` if you rename first — Step 5).
2. Framework preset auto-detects as **Next.js**. Leave build/output settings at defaults; production branch is `main`.
3. Add the environment variables in Step 1 **before** the first deploy (the `NEXT_PUBLIC_*` ones are needed at build time).
4. Deploy. Note the production URL, then set `APP_BASE_URL` to it and redeploy once.

## Step 1 — Environment variables (Vercel project → Settings → Environment Variables)

| Name | Value | Secret? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://bcjdulqvaejosjstuieq.supabase.co` | no (public) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `sb_publishable_MUySVIdDsA5zJRZRgASj-w_6zrmgNHI` | no (publishable) |
| `SUPABASE_SERVICE_ROLE_KEY` | copy from Supabase → Project Settings → API → `service_role` | **YES — keep secret** |
| `APP_BASE_URL` | your Vercel production URL (e.g. `https://freedom-studio.vercel.app`) | no |
| `MOONSHOT_API_KEY` | your Moonshot (Kimi K3) key — optional, AI degrades gracefully without it | **YES** |
| `ZHIPU_API_KEY` | your Zhipu (GLM 5.2) key — optional | **YES** |
| `SHARE_TOKEN_PEPPER` | optional; if set, must be the **same** value in the `share-view` Edge Function secret | **YES** |

Set the two `NEXT_PUBLIC_*` values (public, safe in the browser) so the client
can reach Supabase; the **service-role key is required** for admin actions,
auditing, AI usage metering, and invitations to work. The LLM keys are optional:
without them, AI surfaces show "provider not configured" and everything else
works. Add all applicable vars for the **Production** environment before the
first build.

## Step 2 — Supabase Auth settings (dashboard → Authentication)

These cannot be set via API and are **mandatory** for the security model:

1. **Providers → Email: disable "Enable sign-ups"** (the app is invite-only; a DB trigger also rejects uninvited signups as defense-in-depth).
2. **Enable MFA → TOTP.** ⚠️ Critical: without TOTP enabled, no user can ever reach AAL2, and the RLS policies return **zero rows** for everyone. The app is designed around mandatory 2FA.
3. Enable **leaked-password protection**.
4. Set **minimum password length to 10** (the invite-accept form enforces 10).
5. **URL Configuration**: set **Site URL** to your Vercel production URL, and add `<APP_BASE_URL>/auth/*` to the redirect allow-list.

## Step 3 — Edge Function secrets (optional, dashboard → Edge Functions → Secrets)

- `SHARE_TOKEN_PEPPER` — optional; if you set it here, set the same value in Vercel (Step 1). If unset in both places, plain SHA-256 token hashing is used consistently and share links still work.
- `SHARE_IP_SALT` — optional salt for the share-view per-IP rate limiter.

## Step 4 — Create your Super Admin account

The invitation is already staged. Simplest path:

1. Supabase dashboard → **Authentication → Users → Invite user** → `faisal@falconmind.co`.
   - Because the pending invitation exists, the `handle_new_user` trigger creates your `super_admin` profile automatically.
2. Open the invite email → you land on `/auth/accept` → set a password (≥10 chars).
3. You are forced into **TOTP enrollment** — scan the QR with an authenticator app and verify. Your profile flips to `active` and you reach the dashboard.

(Alternative: invoke the `bootstrap-admin` Edge Function with a `BOOTSTRAP_TOKEN` secret — see `supabase/functions/bootstrap-admin/index.ts`. The dashboard-invite path above needs no token.)

## Step 5 — Rename the GitHub repo (optional but recommended)

GitHub Settings → rename `100-movies-to-watch` → `freedom-studio`. This preserves
history, branches, the PR, and sets up redirects (so an existing Vercel import
keeps working).

Creating `fnamlah/freedom-studio` directly was attempted and is not possible from
this environment: the GitHub integration returns `403 Resource not accessible by
integration` on repo creation, and the session is bound to its configured
repository ("sessions are bound to their configured repositories"). The rename is
a 10-second dashboard action and gives a better result anyway — one repo, full
history, no re-import.

## Post-go-live optimizations (not required)

- Enable the **Custom Access Token Auth Hook** (Auth → Hooks) so RLS reads the role from the JWT claim instead of the `profiles` fallback — pure performance, no policy change needed.
- Configure **custom SMTP** for reliable invite/recovery email.
- Set provider **spend caps** in the Moonshot/Zhipu consoles as a backstop to the in-app budgets.
- Enable **Vercel Deployment Protection** for preview deployments and add log drains (docs/10 §3–§5).

## Verify it works

- Visit the production URL → you should see only the login screen when signed out.
- A bad share link (`<APP_BASE_URL>/share/whatever`) returns a uniform 404.
- The AI assistant shows "provider not configured" until you add an LLM key, then answers questions scoped to your role.
