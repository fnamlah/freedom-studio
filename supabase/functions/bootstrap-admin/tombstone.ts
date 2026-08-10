// =============================================================================
// bootstrap-admin — TOMBSTONE
// -----------------------------------------------------------------------------
// Redeploy this file OVER `index.ts` as soon as the first Super Admin invitation
// has been sent (docs/10-deployment-operations.md provisioning checklist):
//
//   supabase functions deploy bootstrap-admin --no-verify-jwt \
//     --entrypoint supabase/functions/bootstrap-admin/tombstone.ts
//
// then unset the BOOTSTRAP_TOKEN secret.
//
// Deleting the function outright would leave the route free for a later,
// unnoticed redeploy of the real handler; a tombstone keeps the name claimed and
// makes any attempt to use it loudly, permanently gone. It touches no
// environment variable, opens no database client, and has nothing to gate.
// =============================================================================

Deno.serve(
  (): Response =>
    new Response(
      JSON.stringify({
        error: "gone",
        detail: "bootstrap-admin has been used and permanently retired.",
      }),
      {
        status: 410,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
          "X-Content-Type-Options": "nosniff",
          "X-Robots-Tag": "noindex, nofollow",
        },
      },
    ),
);
