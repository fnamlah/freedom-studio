# Freedom Studio

Back-office management software for a studio that manages adult-webcam performers ("models") and the operators who support them.

It is the studio's internal system of record for the **business** side of that work: who the models and operators are, which external platform accounts they work on, hours worked, what the platforms paid, how revenue is split, what each payee is owed, whether compliance paperwork is current, and — through an AI layer that never leaves the server — assisted analysis and document filing.

**It is not a streaming or content platform.** No media content of any kind is stored: no video, no performance images, no chat transcripts. The system holds business records, identity/compliance documents, and financial data only.

---

## Security stance

Three bullets, and everything else in the design follows from them:

- **Row Level Security is the final authority.** Deny by default; every table denies until a policy permits. Application-layer checks exist for UX, not as a security boundary — bypassing the app gains nothing. The browser only ever holds the anon key; the service-role key is server-only and is used solely after the caller's role **and** AAL2 have been verified.
- **Invite-only, AAL2 or nothing.** There is no public registration. Every account exists because it was invited, exactly one Super Admin exists (enforced by a unique index), and a session that has not completed TOTP verification can read **zero rows** — enforced by a restrictive policy on every table, not by a redirect.
- **Everything is auditable and revocable.** `audit_log` and `ledger_entries` are append-only, with no update or delete path for any role including the Super Admin. Documents live in private buckets reachable only through 60-second signed URLs; external share links are hashed, expiring, view-limited, revocable, and return a uniform 404 on every failure so they leak no state.

## Stack

| Layer | Choice |
|---|---|
| App | Next.js 15.5 (App Router, Server Components/Actions), TypeScript strict |
| Styling | Tailwind CSS v4, dark theme via CSS custom properties in `src/app/globals.css` |
| Charts | Recharts |
| Validation | zod |
| Data platform | Supabase — Postgres + RLS, Auth (invite-only, mandatory TOTP/AAL2), private Storage, Edge Functions |
| Client libs | `@supabase/ssr`, `@supabase/supabase-js` |
| AI | Server-side gateway, switchable between Kimi K3 (Moonshot) and GLM 5.2 (Zhipu); pgvector for semantic search |
| Hosting | Vercel (app) + Supabase (data) |

AI runs in **Next.js server routes and actions**. The only Edge Functions in the system are the two that must answer without a session: `share-view` and `bootstrap-admin`.

## Documentation

The design package in [`docs/`](docs/) is authoritative; read it in numerical order.

| # | Document | What it covers |
|---|---|---|
| 00 | [Index & Conventions](docs/00-index.md) | Entry point, glossary, canonical-source rules, documentation conventions |
| 01 | [Product Overview & Requirements](docs/01-overview.md) | What the system is and is not, personas, capabilities, out of scope |
| 02 | [System Architecture](docs/02-architecture.md) | Stack, trust zones, container diagrams, key decision records |
| 03 | [Roles & RBAC](docs/03-roles-rbac.md) | The five roles and the authoritative capability matrix |
| 04 | [Database Schema & RLS](docs/04-database-erd.md) | Enums, tables, constraints, triggers, ER diagram, RLS policy intent |
| 05 | [Auth, Invites & Mandatory 2FA](docs/05-auth-2fa.md) | Invite → first login → forced TOTP; the canonical AAL2 policy snippet |
| 06 | [Documents & Shareable Links](docs/06-documents-sharing.md) | Private bucket, upload/download, compliance expiry, share tokens |
| 07 | [Statistics & Dashboards](docs/07-analytics.md) | SECURITY INVOKER views and RPCs, chart mapping, per-role dashboards |
| 08 | [Security & Threat Model](docs/08-security-threat-model.md) | Threat-by-threat mitigations, headers, secrets, rate limiting, backups |
| 09 | [Accounting](docs/09-accounting.md) | Commission schemes, append-only ledger, maker-checker payouts, forecasting |
| 10 | [Deployment & Operations](docs/10-deployment-operations.md) | Environments, CI/CD, provisioning checklists, env inventory, runbooks |
| 11 | [AI Assistant & LLM Gateway](docs/11-ai-llm.md) | Provider-switchable gateway, tool registry, redaction chokepoint, pgvector |
| 12 | [File Library & AI Classification](docs/12-file-library-classification.md) | The org-wide file library, its schema and bucket, and the bounded AI classification carve-out |

## Repository layout

```
docs/                            design package (00–12), authoritative
src/app/                         Next.js App Router routes and layouts
src/components/                  UI primitives, app shell, chart cards
src/lib/                         Supabase clients, auth guards, audit, settings
src/middleware.ts                session refresh, AAL2 redirects, per-request CSP nonce
supabase/migrations/             ordered SQL: enums → tables → functions → triggers → RLS → views → storage → seeds
supabase/functions/share-view/   anonymous share-link viewer (Edge Function)
supabase/functions/bootstrap-admin/  one-shot first-Super-Admin invite, then tombstoned
supabase/config.toml             Edge Function deployment config (verify_jwt = false for both)
```

## Local development

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env.local        # then fill in the values (see table below)

# 3. Apply the database schema to a Supabase project (or a local stack)
supabase link --project-ref <your-project-ref>
supabase db push                  # applies supabase/migrations in order

# 4. Deploy the Edge Functions (both are intentionally unauthenticated surfaces)
supabase functions deploy share-view --no-verify-jwt
supabase functions deploy bootstrap-admin --no-verify-jwt

# 5. Run the app
npm run dev                       # http://localhost:3000
```

Checks:

```bash
npm run typecheck                 # tsc --noEmit (strict)
npm run lint
npm run build
```

There is no seeded login: the first account is created by the bootstrap flow below, and every account after it is invited from inside the app.

## Environment variables

| Name | Scope | Secret | Purpose |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Browser + server | No | Supabase project URL. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser + server | No | Anon/publishable key. Safe in the browser **because every query it makes passes RLS**. |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server only** | **Yes — critical** | Bypasses RLS. Used only behind the guarded admin client, after the caller's role and AAL2 are verified. Never `NEXT_PUBLIC_*`. |
| `APP_BASE_URL` | Server | No | Absolute origin of the deployment. Used for invite redirects and share-link URLs. |
| `MOONSHOT_API_KEY` | **Server only** | **Yes** | Kimi K3 (Moonshot) API key for the AI gateway. |
| `ZHIPU_API_KEY` | **Server only** | **Yes** | GLM 5.2 (Zhipu) API key for the AI gateway. |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Edge Function runtime | Yes | Injected by Supabase; lets the functions run with the service role, so anonymous callers need zero grants. |
| `SHARE_TOKEN_PEPPER` *(optional)* | `share-view` only | Yes | Pepper mixed into share-token hashing. Rotating it invalidates every outstanding share link — an intentional hard-stop lever. |
| `SHARE_IP_SALT` *(optional)* | `share-view` only | Yes | Salt for the IP hashes written to `document_share_views` and `share_rate_limits`. Falls back to the token pepper. |
| `BOOTSTRAP_TOKEN` | `bootstrap-admin` only | **Yes** | The single gate on the bootstrap function. Set immediately before use, unset immediately after. |
| `BOOTSTRAP_ADMIN_EMAIL` *(optional)* | `bootstrap-admin` only | No | Address that receives the first Super Admin invite. Defaults to the studio owner's address. |
| `SUPABASE_ACCESS_TOKEN` | CI / workstation | Yes | Authenticates the Supabase CLI for migrations and function deploys. Never in Vercel or app code. |

**Invariant:** the browser only ever holds the anon key. Every other credential lives in server env, Edge Function secrets, or the CI secret store — and nowhere else.

## First Super Admin

Only a Super Admin can invite users, and at provisioning time there is none — so `bootstrap-admin` creates exactly that one invitation, once:

```bash
supabase secrets set BOOTSTRAP_TOKEN="$(openssl rand -base64 32)"
curl -X POST -H "Authorization: Bearer $BOOTSTRAP_TOKEN" \
  "https://<project-ref>.supabase.co/functions/v1/bootstrap-admin"
```

Then, immediately:

```bash
supabase functions deploy bootstrap-admin --no-verify-jwt \
  --entrypoint supabase/functions/bootstrap-admin/tombstone.ts
supabase secrets unset BOOTSTRAP_TOKEN
```

The function refuses with `409` once any `super_admin` profile exists, and answers a uniform `404` to every unauthenticated or malformed request. After the tombstone redeploy it answers `410 Gone` permanently.

## Provisioning

Full provisioning — environments, CI/CD, the Supabase and Vercel checklists, Auth configuration, and the operational runbooks for backups, key rotation, MFA recovery, share-link leak response, the monthly accounting close, and AI model switches — is specified in **[docs/10 — Deployment & Operations](docs/10-deployment-operations.md)**. Start there before touching a production project.
