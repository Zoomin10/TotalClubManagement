# TruDash membership pilot integration

The member-management screen runs inside TruDash and uses its Microsoft session. The existing TCM backend, PostgreSQL database, public registration form and Stripe webhooks remain in place.

A new Membership pilot menu item is visible only when configured, enabled and available to the signed-in Microsoft username. Existing Members/TeamFeePay views remain as they are.

## Files

The TruDash and TotalClubManagement folders contain only new or changed files. Copy their contents into the matching repositories, preserving relative paths. Do not replace either entire repository.

Alternatively, apply the corresponding .patch in each repository with git apply after checking it with git apply --check. The base commit for each patch is recorded in its adjacent base-commit text file. If your source has changed since then, merge the changes rather than replacing newer files.

TruDash changes:
- server.js mounts the authenticated membership proxy.
- routes/membershipPilot.js authorizes the Microsoft session against an admin username allowlist and signs outgoing API requests.
- frontend/src/App.jsx adds the feature menu without changing existing Members views.
- frontend/src/components/MembershipPilot.jsx and MembershipPilot.css provide the embedded management screen without a separate password login.

TCM changes:
- backend/src/middleware/trudashAdmin.js validates short-lived, signed requests from TruDash.
- backend/src/routes/admin.js accepts verified TruDash requests and can disable standalone password authentication.

No migration, new dependency or TruDash database connection is required.

## Start in Development

Use TruDash develop and the corresponding TCM development backend and frontend. Do not point development TruDash at the production TCM database/backend unless that is explicitly your intended test arrangement. Apply and deploy the TCM backend changes first, followed by TruDash.

### Generate a shared secret locally

Run this once in a terminal and keep the output private:

    node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"

Use that same output for TRUDASH_MEMBERSHIP_SHARED_SECRET in the two backend services. Do not put it in Git, a frontend variable or a VITE_* variable.

### TCM backend Railway variables

    TRUDASH_MEMBERSHIP_SHARED_SECRET=<the generated value>
    TRUDASH_ONLY_ADMIN_AUTH=true

Leave DATABASE_URL, FRONTEND_URL, Stripe prices/keys/webhook secret and existing registration configuration unchanged. FRONTEND_URL must continue to refer to TCM's public frontend because it controls CORS and Checkout return URLs.

TRUDASH_ONLY_ADMIN_AUTH=true disables TCM's standalone password login and legacy admin-cookie access. Management then runs through TruDash. The old TCM /admin frontend can still render its login screen, but that login is intentionally unavailable in this mode.

### TruDash backend Railway variables

    MEMBERSHIP_PILOT_ENABLED=true
    MEMBERSHIP_PILOT_ADMIN_EMAILS=<your Microsoft sign-in username>
    TCM_BACKEND_URL=https://<matching-TCM-backend-host>
    TCM_REGISTRATION_URL=https://<matching-TCM-public-frontend-host>/
    TRUDASH_MEMBERSHIP_SHARED_SECRET=<the same generated value>

APP_BASE_URL must be set to the actual TruDash frontend origin used in that environment; keep the existing Microsoft client, tenant and session variables. Browser writes are checked against this origin.

Use the username shown by GET /api/auth/me after Microsoft sign-in for MEMBERSHIP_PILOT_ADMIN_EMAILS. For several authorized admins, use comma-separated Microsoft usernames. Comparison is case-insensitive. A blank allowlist grants no access. This is an explicit access list for the pilot, not a new Microsoft app role or a blanket grant to everyone in the tenant.

The existing production TCM URLs are:

    TCM_BACKEND_URL=https://tcp-production-backend.up.railway.app
    TCM_REGISTRATION_URL=https://wwfc-tcp.up.railway.app/

Use these only when configuring the production pairing. Keep MEMBERSHIP_PILOT_ENABLED=false or unset in production if the pilot should appear only in Development.

## How access works

The browser calls /api/membership-pilot on TruDash's own origin. TruDash requires its server-side Microsoft session and the configured username allowlist. It forwards only member list, invoice list/sync, registration CSV export, payment cancellation and test-member deletion requests.

TruDash sends a server-signed assertion valid for 30 seconds. TCM checks its issuer, audience, role, signature, expiry, method, path and request-body hash before granting admin access. Assertions are never returned to the frontend. Browser cookies and incoming identity headers are not forwarded to TCM. Writes additionally require a matching browser Origin at TruDash.

The TCM backend keeps a bounded, in-memory replay cache for assertions in each server process. This is suitable for the current pilot but is not a distributed replay cache across several backend replicas. Do not share the secret with any other service.

Registration remains public at the existing TCM frontend. The Public registration form link in the pilot opens that URL in a new tab. Microsoft authentication is not added to the registration or Stripe webhook routes.

## Verify after deployment

1. Sign in to TruDash using an allowlisted Microsoft account. Membership pilot should appear in the sidebar.
2. Open it. The existing test members should load without another password prompt.
3. Search/filter, open a member, view invoice history and export registrations.
4. Use Sync invoices on a test member. Verify summary balances refresh.
5. Test cancellation and, if needed, deletion only on test members. The existing confirmation and Stripe test-only controls remain in force.
6. Open the public registration link in a signed-out/private window. It should remain accessible.
7. Check signed-out /api/membership-pilot/members returns 401. A signed-in username outside the allowlist should get 403 on member requests and should not see the menu.
8. With TRUDASH_ONLY_ADMIN_AUTH=true, TCM standalone password login is unavailable and unauthenticated direct admin API calls return 401.

If the menu is absent, confirm the feature flag, URLs, allowlist and shared-secret settings. GET /api/membership-pilot/config while signed in reports enabled and available without exposing secrets. After changing settings or deploying, refresh the browser page.

If a cancellation/deletion request times out, refresh and check its result before retrying: the TCM backend may have completed it even if TruDash did not receive the response.

## Validation completed here

- TruDash production frontend build passed.
- Backend JavaScript syntax and Git diff whitespace checks passed.
- Frontend lint passed with six pre-existing unused-icon import warnings in App.jsx.
- Ten request-level checks passed: signed-out denial, allowlist/feature denial, invalid configuration denial, valid assertions and header isolation, mutation Origin and body binding, proxy path restrictions, replay denial, signature/path/method/body tamper denial, expired assertion denial, and integration-only legacy-cookie denial with verified-TruDash acceptance.

These checks used local simulated sessions and upstream responses, not live Microsoft login, Railway deployment or Stripe. A rendered visual check and live environment acceptance checks are still required.

## Rollback

Set MEMBERSHIP_PILOT_ENABLED=false in TruDash to hide and disable the pilot. If you need TCM's previous password-based admin access back, set TRUDASH_ONLY_ADMIN_AUTH=false and keep its ADMIN_PASSWORD and JWT_SECRET configured. The public registration form and Stripe webhooks are unaffected by these switches.
