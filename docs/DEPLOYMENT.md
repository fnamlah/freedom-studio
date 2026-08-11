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
- **App**: full Next.js 15 build — every route typechecks and builds; redactor egress tests pass.

## Step 0 — Deploy the app to Vercel (Git import)

The app is a 184-file Next.js codebase, which is too large to push through the
Vercel MCP's inline upload — so deploy it the standard way, via Git. This also
gives you automatic redeploys on every future push.

1. Rename the GitHub repo to `freedom-studio` first if you want the final name (Step 5), or import it as-is.
2. Vercel dashboard → **Add New… → Project → Import** your GitHub repo (`fnamlah/100-movies-to-watch`, or `freedom-studio` after rename).
   - If the branch isn't merged to `main` yet, set the project's **Production Branch** to `claude/studio-management-diagram-waegdz`, or merge the PR to `main` first.
3. Framework preset auto-detects as **Next.js**. Leave build/output settings at defaults.
4. Add the environment variables in Step 1 **before** the first deploy (the `NEXT_PUBLIC_*` ones are needed at build time).
5. Deploy. Note the production URL, then set `APP_BASE_URL` to it (Step 1) and redeploy once.

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
history, the branch, and redirects. (Repo creation via the integration was not
permitted, so a rename is the clean way to the final name.)

## Post-go-live optimizations (not required)

- Enable the **Custom Access Token Auth Hook** (Auth → Hooks) so RLS reads the role from the JWT claim instead of the `profiles` fallback — pure performance, no policy change needed.
- Configure **custom SMTP** for reliable invite/recovery email.
- Set provider **spend caps** in the Moonshot/Zhipu consoles as a backstop to the in-app budgets.
- Enable **Vercel Deployment Protection** for preview deployments and add log drains (docs/10 §3–§5).

## Verify it works

- Visit the production URL → you should see only the login screen when signed out.
- A bad share link (`<APP_BASE_URL>/share/whatever`) returns a uniform 404.
- The AI assistant shows "provider not configured" until you add an LLM key, then answers questions scoped to your role.
