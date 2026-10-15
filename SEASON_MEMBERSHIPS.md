# Season memberships — development pilot

Prepared against TotalClubManagement main e711fc0 and TruDash main 9c3b751 (14 October 2026). This package contains source changes, not a deployment. No existing database or Stripe records were changed while preparing it. Stripe test keys remain mandatory.

## Behaviour

- Seasons run 1 June–31 May. A continuing member explicitly accepts the next season's terms and fee, then completes card setup. That schedules June–May monthly collections. There is no automatic renewal or charge simply because a renewal link was generated.
- New joiners pay on the first of the following calendar month through the final May payment. For a May registration, the next June season must already be published and is shown before submission.
- A schedule ends at the June boundary with cancellation, rather than releasing into an indefinite subscription. Its final scheduled collection is 1 May. Outstanding invoices are retained and are not forgiven, refunded or retried by these new actions.
- “Member has left” cancels all recorded current and future seasonal plans plus the root legacy plan. It preserves member, agreement and invoice history. A failed Stripe cancellation is reported as an error: retry and verify Stripe before considering departure complete.
- Player/contact records remain linked to separate SeasonMembership rows. Accepted terms/version, fee, signature name, permissions and acceptance time are saved for each new seasonal signup or renewal. Legacy conversion records an administrator's confirmation; it does not invent a parent's acceptance.
- Renewal asks for fresh health declarations without displaying stored health details. Admin season JSON excludes medical information. Existing separately permitted full CSV export remains unchanged.
- Current-plan fields in the member directory are updated when a renewal subscription actually starts. Before then, inspect the future season in Seasons & renewals.

## Install in Development first

1. Copy `TotalClubManagement/` contents into the TCM repository, and `TruDash/` contents into the TruDash repository, preserving paths. These are changed files, not full replacement repositories. Compare with any subsequent local changes. Alternative: apply the matching patch using `git apply --check` then `git apply`; do not both copy and apply.
2. Commit on the development branches. No new npm dependencies are required. Keep both environments' URLs, database references, Microsoft permissions and bridge secrets separate.
3. Deploy TCM backend first. Keep your existing Prisma generation build step and migration deployment step. From `backend`, the migration deployment command is `npx --no-install prisma migrate deploy` with that environment's DATABASE_URL. Do not use `migrate dev` or reset the Railway database. The new committed migration adds ClubSeason, SeasonPlan, SeasonMembership, SeasonChange, and an optional invoice-season link; it does not delete or backfill existing rows.
4. Deploy TCM frontend and TruDash. The public TCM frontend must route `/renew/<token>` to its SPA, just as it routes the existing public form. Existing Vite/Railway SPA fallback settings should do this.
5. In Stripe's test webhook destination, retain existing Checkout/subscription/invoice events and include `subscription_schedule.created`, `subscription_schedule.updated`, `subscription_schedule.canceled`, and `subscription_schedule.completed`. These supplement completion and cancellation reconciliation.
6. Keep `SEASON_MEMBERSHIP_ENABLED=false` on the TCM backend while configuring and testing. The default when absent is false: legacy public signup remains in use. This flag does not hide the administrator's season controls.

## Configure and move existing pilot plans

In TruDash open **Membership pilot → Seasons & renewals**. The user needs MEMBERS_MANAGE. Creating and publishing a season additionally requires Super Admin access. Existing Microsoft authentication and database-backed application permissions still apply; belonging to the email domain alone does not grant access.

1. Create the current season, e.g. start year 2026 means 2026/27. Supply approved club terms/version and both monthly amounts and Stripe test Price IDs. Monthly GBP prices must match the amounts exactly. Use a new Stripe Price for a changed fee; prices from a previous season may be reused if the fee remains identical. Saving creates a draft. Verify it before publishing; this first version does not provide draft editing or published fee editing.
2. For each existing open-ended test plan, select the member and current season and choose **Set existing plan’s season end**. This explicitly changes that member's existing schedule/subscription to end at the following June boundary without changing its amount. It captures the legacy membership season. Verify the cancellation date in Stripe.
3. An earlier scheduled cancellation is never extended. A complex schedule or an old anchor other than 00:00 UTC on the 1st is blocked for manual review. Do not bypass the guard or assume all old plans were converted. If Stripe succeeds but the database write fails, safely retry the same action and inspect the record/Stripe state.
4. Create and publish the next season, e.g. 2027/28, using the agreed new fees and terms.
5. Select the next season/member and create a private renewal link. Share it with the correct parent/carer through your normal channel. It expires after 30 days or at the season start, whichever is sooner. Creating another link invalidates the previous unaccepted link. No emails are sent automatically by this feature.
6. The parent reviews details, freshly declares medical conditions/permissions, accepts terms and completes Stripe card setup. Only then is a new schedule created. An unbounded prior plan blocks scheduling to prevent duplicate June collections. An accepted renewal with failed/abandoned setup appears **Awaiting payment setup**; its parent link can resume while valid. An authorised administrator can also use **Get payment setup link** for the accepted membership and share that private Stripe link with the parent.
7. Once current and upcoming published offers are correct, set `SEASON_MEMBERSHIP_ENABLED=true` on the TCM backend and redeploy. A missing published season now blocks new registrations before a record is created. Existing legacy plans are not automatically converted by this flag.

New schedule anchors use 00:00 UTC on the 1st, which is 00:00 or 01:00 UK time depending on daylight saving. This keeps collections on the UK calendar 1st throughout the year. Schedules expire at June 1 00:00 UTC after May's collection; they are not twelve-month contracts that prevent an earlier departure.

## Development test checklist

Use dedicated test members and a ready Stripe test clock that is before the intended first-payment date. Do not reuse a clock already beyond that date. Never enter real card details for this pilot.

1. Configure current and next seasons. Submit a new registration with the seasonal flag enabled. Confirm its SeasonMembership and schedule IDs, plan/amount/terms evidence and `end_behavior=cancel`. The directory should show Scheduled after the setup webhook.
2. Generate a next-season renewal. Confirm the public link shows the new fee, permits contact corrections and fresh declarations, and does not display old health details. A link by itself must not create a payment schedule. Accept but abandon Checkout; confirm Awaiting payment setup and resume it from the parent or administrator link.
3. Try renewal while the old plan remains indefinite: no new schedule should be created. Bound the old plan using its current season, then resume setup. Inspect that old and new schedules meet at the June boundary without overlap.
4. Advance the clock through May 1, let it return to ready and wait for webhooks/invoice finalisation. Confirm May's old-plan invoice. Advance to June 2 and verify old cancellation, exactly one new-season June invoice at the new price, and correct invoice-season links. Advance another month to verify the new July collection.
5. Test a separate member who does not renew: the bounded old plan must end without a June subscription/collection. A saved offer is not renewal.
6. Test **Member has left** both before and after a future renewal is scheduled. Verify all current/future plans in Stripe are cancelled and no new invoices arise when advancing time. Existing unpaid invoices must remain intact. Retry cancellation after a simulated failure and check the result rather than treating LEFT alone as proof that Stripe cancellation finished.
7. Retry the Checkout webhook: no second schedule. Retry an older invoice/subscription event after the new season starts: it must update its own history and not overwrite the newer plan.
8. Test a permitted member manager, a Super Admin with MEMBERS_MANAGE, and an account without MEMBERS_MANAGE. Managers can manage memberships; only the Super Admin can create/publish fees; unauthorised accounts cannot read season administration through either UI or direct API. Medical JSON stays excluded and the full CSV remains separately permission-controlled.

Local checks run from repository roots:

```
# TCM
node --test tests/seasons.cjs tests/season-routes.cjs
npm --prefix frontend run build
# From TCM/backend with a local DATABASE_URL
npx --no-install prisma validate
# TruDash
node --test tests/season-proxy.cjs
npm --prefix frontend run build
```

The package was checked with 27 local automated tests, both frontend builds, Prisma schema validation/generation, and application of the full migration chain in an isolated embedded PostgreSQL database. Tests use mocked Stripe calls; the Railway/Stripe test-clock flow above still needs to be exercised before promotion to Production.

## Limits and handling

- Accepted renewals after the first-payment date, including delayed card setup, require club review. The app refuses to backdate or take an unannounced immediate payment. It does not silently change the agreed date.
- The existing retention-review report still infers seasons from original registration dates. It now explicitly directs you to confirmed season records. It does not incorporate renewals/departures yet, archive records or delete anything. Automatic archiving and separate holds/retention decisions remain future work.
- New season memberships are protected from the old test-member deletion button by a server check and restrictive database relationships. Use departure, not deletion, for these records.
- Private renewal URLs are bearer credentials and reveal limited member/contact details to their holder. Store/share them securely and avoid including full URLs in logs or analytics. Tokens are hashed in the database and consumed after payment setup; no third-party scripts were added to the page. The public endpoint has a small in-process rate cap; production infrastructure-level abuse controls are separate work.
- Leaving preserves invoices and may leave previously failed invoices open. Review arrears separately, including any Stripe retry settings. No refund or automatic debt write-off is performed.
- Rolling back the flag affects new registrations only. Existing fixed seasonal schedules remain fixed and continue to need the seasonal webhook handler. Do not roll back the backend or remove tables while these schedules exist.
