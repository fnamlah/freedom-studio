# Agent handoff — Freedom Studio: test & deploy

Context for a Claude Code session running on a machine with real network access
and the Supabase + Vercel MCPs connected. The app is **fully built**; what
remains is end-to-end testing against the live database and the production
deploy — both of which the build environment could not do (its egress proxy
blocked `api.vercel.com` and `*.supabase.co`, and the Vercel MCP's inline
upload cannot carry a 184-file app).

---

## 1. What Freedom Studio is

Secure back-office platform for a studio managing adult-webcam performers
("models") and the operators who support them. **Business records only** — no
media content. Next.js 15 (App Router, TypeScript strict, Tailwind v4) on
Vercel + Supabase (Postgres/RLS, Auth with mandatory TOTP, private Storage,
Edge Functions). Security is prioritized over performance throughout.

Features: invite-only auth with forced TOTP; 5 roles; models/operators;
platform accounts; work sessions & earnings; effective-dated commission
schemes; append-only ledger with maker-checker payouts; per-payee statements;
compliance documents with revocable expiring share links; an AI file library
that classifies uploads into categories; per-role analytics dashboards
(pie/line/bar); forecasting; and an AI assistant switchable between
**Kimi K3 (Moonshot)** and **GLM 5.2 (Zhipu)**.

Design docs are authoritative and live in `docs/00-index.md` … `docs/12-…`.
Read `docs/00-index.md` first. `docs/DEPLOYMENT.md` is the operator runbook.

## 2. Live infrastructure (already provisioned — do not recreate)

| Thing | Value |
|---|---|
| Supabase project | `freedom-studio`, ref **`bcjdulqvaejosjstuieq`**, region `ap-south-1`, Postgres 17 |
| Supabase org | FalconMind — `ybbniwujhqflebalkerr` |
| Supabase URL | `https://bcjdulqvaejosjstuieq.supabase.co` |
| Publishable (anon) key | `sb_publishable_MUySVIdDsA5zJRZRgASj-w_6zrmgNHI` |
| Service-role key | **Not in any file.** Supabase → Settings → API Keys |
| Migrations | `001`–`012` **already applied** (26 tables, 98 policies, seeds) |
| Edge functions | `share-view` and `bootstrap-admin` — deployed, ACTIVE, `verify_jwt=false` |
| Seeds | 9 `doc_categories` (identity has `ai_enabled=false`), 13 `ai.*` settings, 1 default commission scheme |
| Staged bootstrap | a **pending `super_admin` invitation for `faisal@falconmind.co`** |
| Vercel team | "Faisal's projects" — `team_Uu0GD2h2nh9d7jAJrt6kp1Qv` |
| GitHub repo | `fnamlah/100-movies-to-watch`, branch **`main`** (may be renamed to `freedom-studio`) |

Security advisors currently report **6 WARN** findings — all the RLS helper
functions that must remain executable by `authenticated` for policy evaluation.
That is by design (migration `012` already revoked everything else). Do not
"fix" them by revoking `authenticated`; that would break every RLS policy.

## 3. Security invariants — do not weaken

1. **RLS is the final authority.** App checks are UX. Every table has a
   RESTRICTIVE `aal2 + active profile` policy plus per-role permissive policies.
2. **Service-role key is server-only**, reached exclusively through
   `guardedAdminClient(roles)` (verifies role + AAL2 *before* constructing the
   client). One sanctioned exception: post-TOTP profile activation
   (`src/app/auth/mfa-enroll/actions.ts`) — self-scoped, `invited→active` only.
3. **Aggregates-only AI egress.** All provider-bound payloads pass the single
   chokepoint `src/lib/ai/redactor.ts`. The one documented exception is
   `classificationChannel` for the file library (`docs/12`). Never add a second
   path to a provider.
4. **No raw SQL / write tools for the AI agent.** Its 12 tools execute under the
   caller's RLS client against SECURITY INVOKER views/RPCs.
5. **Maker-checker:** finance creates/settles payouts, only super_admin approves.
6. `audit_log` and `ledger_entries` are append-only.

## 4. Gotchas discovered during the build

- **`src/middleware.ts`, not root `middleware.ts`** — with `src/`, Next silently ignores a root middleware (empty middleware-manifest = zero AAL2 enforcement).
- **`.gitignore`**: the inherited Python venv rule `lib/` was anchored to `/lib/`; if you ever regenerate it, make sure `src/lib` stays tracked.
- **TOTP must be enabled in Supabase Auth**, or nobody reaches AAL2 and RLS correctly returns zero rows for everyone. This looks like "the app is broken" but is the design.
- **Profiles start `status='invited'`** and are flipped to `active` only after TOTP verification; until then the user reads zero rows.
- **`handle_new_user` rejects any signup without a pending invitation** — defense in depth behind disabled public signups.
- **`src/lib/database.types.ts`** ends with a hand-written compatibility appendix (row aliases). Re-append it after any `supabase gen types` regeneration.
- **`SHARE_TOKEN_PEPPER`** must be identical in the Next.js env and the `share-view` edge function secret, or every share link 404s. Unset in both = plain SHA-256, which also works.
- **`/share/:token`** is rewritten to the edge function in `next.config.ts`; it is the only anonymous surface.
- The **default commission scheme's `effective_from` is the provisioning date** — back-date it before importing historical earnings, or `fn_generate_earning_shares` raises "no commission scheme resolves".
- Tests live at `src/lib/ai/redactor.test.ts` and run with `npm test` (`node --test`); `*.test.ts` is excluded from `tsconfig`.

## 5. Your job

**A. Get it running locally**
```bash
git clone https://github.com/fnamlah/100-movies-to-watch.git freedom-studio
cd freedom-studio && npm install
# .env.local:
#   NEXT_PUBLIC_SUPABASE_URL=https://bcjdulqvaejosjstuieq.supabase.co
#   NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_MUySVIdDsA5zJRZRgASj-w_6zrmgNHI
#   SUPABASE_SERVICE_ROLE_KEY=<from dashboard>
#   APP_BASE_URL=http://localhost:3000
npm run typecheck && npm test && npm run build
```

**B. Configure Supabase Auth** (dashboard; not settable via MCP): disable public
sign-ups, **enable TOTP MFA**, enable leaked-password protection, set minimum
password length to 10, and set Site URL + `/auth/*` redirect allow-list.

**C. Bootstrap the Super Admin**: Authentication → Users → Invite
`faisal@falconmind.co` (the pending invitation makes the trigger create the
`super_admin` profile). Accept → set password → enroll TOTP.

**D. End-to-end test with the database actually reachable** — this is the part
that has never been run. Drive a real browser (Playwright). At minimum:
1. Sign-in → forced TOTP challenge → dashboard renders per role.
2. Invite a test manager, model, operator, finance user; verify each sees only
   what `docs/03` grants (a model sees only their own rows; finance sees zero
   documents; operator sees zero raw earnings).
3. Create model → platform account → earning → run "Close period"
   (`fn_generate_earning_shares`) → verify ledger credits and `v_payee_balances`
   reconcile to the cent; re-run and confirm it is idempotent (0 posted).
4. Payout: create pending → confirm finance **cannot** approve → super_admin
   approves → finance marks paid → settlement entry auto-posts and balance drops.
5. Documents: upload → 60-second signed download → create share link → open it
   anonymously in a clean context → revoke → confirm the same link now 404s, and
   that a garbage token returns an identical 404 (no state oracle).
6. Library: upload a PDF and an image → classify → suggestion appears in the
   review queue → confirm/override writes the category + audit row. Verify an
   `ai_exempt` file and anything in the `identity` category are never sent.
7. AI assistant: ask an analytics question, confirm tool calls run under the
   caller's RLS (a manager and a model get different answers) and that
   `ai_messages`/`ai_usage` rows are written. Switch provider in admin settings
   and confirm `ai.model_switch` is audited.
8. Confirm `audit_log` shows the dotted-verb trail for everything above.
Fix whatever breaks; keep `npm run typecheck && npm test && npm run build` green.

**E. Deploy to Vercel** (Git import — the codebase is too large for the MCP's
inline upload): import the repo, framework auto-detects Next.js, production
branch `main`, set the env vars from §2 (plus `MOONSHOT_API_KEY` / `ZHIPU_API_KEY`
if available — the AI degrades gracefully without them), deploy, then set
`APP_BASE_URL` to the production URL and redeploy. Enable deployment protection
for preview deployments. Finally back-fill the Supabase Site URL / redirect
allow-list with the production domain.

**F. Verify production**: signed-out users see only the login screen; a garbage
`/share/<token>` returns the uniform 404; security headers present (HSTS,
nosniff, `frame-ancestors 'none'`, per-request CSP nonce); `get_advisors` still
clean apart from the 6 documented helper warnings; check `get_runtime_errors`
and the Supabase logs after the first real login.

**Report**: what passed, what you fixed, and anything you deliberately left —
with the reason.
