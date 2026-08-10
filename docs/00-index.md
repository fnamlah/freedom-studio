# 00 — Index & Conventions

This document is the entry point for the Studio Management System design-documentation package. It lists every document in the package with a one-line summary, defines the shared glossary used throughout, and records the documentation conventions — cross-referencing rules, canonical-source rules, Mermaid usage, and the package-wide design-only rule — that every other document in `docs/` follows.

Related docs: [01 — Product Overview & Requirements](01-overview.md) · [02 — System Architecture](02-architecture.md) · [03 — Roles & RBAC](03-roles-rbac.md) · [04 — Database Schema & RLS](04-database-erd.md) · [05 — Auth, Invites & Mandatory 2FA](05-auth-2fa.md) · [06 — Document Management & Shareable Links](06-documents-sharing.md) · [07 — Statistics & Dashboards](07-analytics.md) · [08 — Security & Threat Model](08-security-threat-model.md) · [09 — Accounting](09-accounting.md) · [10 — Deployment & Operations](10-deployment-operations.md)

---

## 1. What this package describes

The Studio Management System is back-office management software for a studio that manages adult-webcam performers ("models"). It is **not** a streaming or content platform: no media content is ever stored. The system holds business records, identity/compliance documents, and financial data only. The product scope, personas, and non-functional priorities are defined in [01 — Product Overview & Requirements](01-overview.md).

The security stance stated there applies to every document in this package and should be read as a package-wide invariant:

> **Security over performance. Deny by default. Invite-only access. Mandatory TOTP 2FA (AAL2). Row Level Security is the final authority. Full audit trail.**

## 2. Design-only rule

**This package is design-only. No code or infrastructure is implied to exist.** Every document describes a system that *will be built*: schema definitions, policies, flows, and configuration are specifications, not descriptions of a deployed system. Where a document uses present tense ("the ledger is append-only"), it describes the design's intent, not a running artifact. Provisioning and implementation steps are themselves specified — as a plan — in [10 — Deployment & Operations](10-deployment-operations.md).

## 3. Table of contents

| # | Document | One-line summary |
|---|----------|------------------|
| 01 | [Product Overview & Requirements](01-overview.md) | What the system is (and is not), the six personas, core capabilities with pointers to their design docs, non-functional priorities, and explicit out-of-scope items. |
| 02 | [System Architecture](02-architecture.md) | The Next.js-on-Vercel + Supabase stack, C4-container-style diagrams, the three-trust-zone request path (browser / server / database), and mini-ADRs for the key decisions. |
| 03 | [Roles & RBAC](03-roles-rbac.md) | The enum-based role model, the JWT role claim design, the single-Super-Admin enforcement trick, the **authoritative capability matrix**, and the maker-checker rationale for payouts. |
| 04 | [Database Schema & RLS](04-database-erd.md) | Every enum, table, column, constraint, index, trigger, and helper function; the full ER diagram; and the per-table × per-role RLS policy-intent matrix. |
| 05 | [Auth, Invites & Mandatory 2FA](05-auth-2fa.md) | Invite → first-login → forced TOTP enrollment, normal login, the two-layer AAL2 enforcement design (middleware UX + the **canonical RESTRICTIVE policy snippet**), and recovery paths. |
| 06 | [Document Management & Shareable Links](06-documents-sharing.md) | The private storage bucket design, upload/download flows, compliance-expiry derivation, and the hashed, expiring, revocable share-token system served by an Edge Function. |
| 07 | [Statistics & Dashboards](07-analytics.md) | The SECURITY INVOKER analytics principle, the view and RPC catalog, the chart-mapping table, and per-role dashboard composition. |
| 08 | [Security & Threat Model](08-security-threat-model.md) | Threat-by-threat mitigation table (account takeover, document leakage, privilege escalation, insider misuse, …) plus platform hardening: headers, secrets inventory, rate limiting, backups. |
| 09 | [Accounting: Splits, Ledger, Payouts & Forecasting](09-accounting.md) | Commission-scheme resolution, the append-only polymorphic-payee ledger, the maker-checker payout/settlement flow, payee statements, and the forecasting design. |
| 10 | [Deployment & Operations](10-deployment-operations.md) | Environments and CI/CD pipeline, MCP-driven provisioning checklist, configuration and env-var inventory, and operational runbooks. |

### Reading order

Documents are written to be read in numerical order: 01–02 establish product and architecture, 03–05 establish identity and authorization, 06–08 cover documents, analytics, and the threat model, and 09–10 close with accounting and operations. One ordering note matters: **[09 — Accounting](09-accounting.md) extends 03, 04, and 07 with the accounting module** (operator roles and capabilities, ledger/payout tables, and accounting-driven charts respectively) — read it after [07 — Statistics & Dashboards](07-analytics.md) so that the roles, schema, and analytics surfaces it builds on are already familiar.

## 4. Glossary

| Term | Definition |
|------|------------|
| **Model** | A performer managed by the studio. A business record in the `models` table; optionally linked to a login (`profiles`) for self-service. The subject of compliance documents and a payee of earnings shares. |
| **Operator** | Support staff (e.g. chatters/account operators) who work on models' accounts and participate in revenue splits. A business record in the `operators` table; optionally linked to a login; a payee like a model, but with no compliance documents. |
| **Platform** | An external webcam site on which models perform. A lookup record only — the system stores no platform content, only names and account references. |
| **Platform account** | A specific model's account on a specific platform (username, status, platform fee percentage). The unit against which sessions, earnings, and account-specific commission schemes attach. |
| **Work session** | A time-tracking record of a model working on a platform account: start/end, derived duration, and per-session gross earnings when known. The **hours** source of truth. |
| **Earning (statement period)** | An authoritative money record for a platform statement period (gross, platform fee, net received by the studio) per platform account. The **money** source of truth, distinct from work sessions. |
| **Payout** | A record of money the studio pays out to a payee for a period: created pending, approved by the Super Admin, then marked paid — at which point a settlement ledger entry is posted automatically. |
| **Ledger entry** | An append-only row recording money owed to or settled with a payee: earning shares and positive adjustments as credits, deductions and payout settlements as debits. Corrections are reversing entries, never edits. |
| **Payee** | The party a ledger entry or payout is addressed to — either a model or an operator, identified polymorphically by (`payee_type`, `payee_id`) referencing the business tables. |
| **Commission scheme** | An effective-dated rule splitting studio net revenue into model / operator-pool / studio percentages, scoped to a platform account, a model, or the studio-wide default. |
| **Share token** | A high-entropy random token embedded in an external document-share URL. Only its SHA-256 hash is stored; the link is expiring, view-limited, and revocable. |
| **AAL2** | Authenticator Assurance Level 2: a session that has completed both password and TOTP verification. Every capability in the system requires an AAL2 session, enforced at the database layer. |
| **RLS** | Row Level Security — Postgres per-row access policies. In this design, RLS is the final authority on authorization; application-layer checks are UX conveniences, not security boundaries. |
| **SECURITY INVOKER / DEFINER** | Postgres execution modes for views and functions. INVOKER objects run with the caller's permissions (RLS applies to the caller); DEFINER objects run with the owner's. This design uses INVOKER for all analytics and confines DEFINER to a few narrow, hardened helpers. |
| **Maker-checker** | Separation of duties for payments: Finance creates obligations and records settlements ("maker"), while only the Super Admin can approve a payout ("checker"), so no single role can originate and release funds end-to-end. |

## 5. Documentation conventions

The following conventions bind every document in this package.

### 5.1 Structure

- Files live in `docs/` and are numbered `00-index.md` through `10-deployment-operations.md`.
- Every document starts with an H1 title, a one-paragraph scope statement, and a **Related docs** line linking sibling documents by relative path.
- Documents cross-reference each other **by number and link** (e.g. "see [04 — Database Schema & RLS](04-database-erd.md)"), never by restating the referenced content.

### 5.2 Canonical-source rules

To keep the package free of drift, certain content has exactly one home. Other documents link to it and never duplicate it:

| Canonical content | Lives only in | Everyone else |
|---|---|---|
| Role capabilities (the authoritative capability matrix) | [03 — Roles & RBAC](03-roles-rbac.md) | Links to 03; 04's RLS matrix is derived from it |
| Table and column definitions (full schema) | [04 — Database Schema & RLS](04-database-erd.md) | Links to 04 |
| The AAL2 RESTRICTIVE policy snippet (exact SQL) | [05 — Auth, Invites & Mandatory 2FA](05-auth-2fa.md) | References it, including 04 |

### 5.3 Diagrams

Diagrams are written in GitHub-flavored Mermaid, which GitHub renders natively — no external tooling is required to read this package. Only conservative syntax is used: `flowchart`, `erDiagram`, `sequenceDiagram`, and `stateDiagram-v2`; node labels containing special characters are quoted; no interactivity (`click`), experimental features, or styling that GitHub strips. In ER diagrams, only types and PK/FK/UK markers appear — CHECK constraints and other rules Mermaid cannot express are carried in the accompanying markdown tables (04 states this explicitly).

### 5.4 Data conventions

Unless a table specifies otherwise: identifiers are `uuid`, money columns are `numeric(12,2)`, and percentage columns are `numeric(5,2)`. Timestamps are `timestamptz`. These defaults are restated where they matter in [04 — Database Schema & RLS](04-database-erd.md).

### 5.5 Tone

Documents are written as precise engineering design: declarative, specific, and traceable. Because of the design-only rule (section 2), nothing is described as deployed — designs say what the system *will do* or *is designed to do*.
