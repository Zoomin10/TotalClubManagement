# Reviewed retention and restricted archive — 15 October 2026

This is an incremental update on top of the previously delivered season-memberships feature. It does not add bulk renewals. No Railway database, Stripe record or live service was changed while preparing it.

## What changes

- TruDash **Membership pilot → Retention & archive** replaces the earlier read-only, registration-date-based review. Access requires both Super Admin and MEMBERS_MANAGE, checked on TruDash and again on TCM.
- The review uses confirmed seasonal memberships, including administrator-confirmed legacy memberships. Original registration dates remain labelled estimates only and cannot authorise an archive. Unaccepted offers and renewals cancelled before their season starts do not establish a later actual membership season.
- Current members, accepted future renewals, mid-season leavers whose actual season has not ended, and members with open unpaid invoices cannot be archived. For your current test members in 2026 / 27, being marked Cancelled on an advanced Stripe clock does not make their real-world retention season end early. Stripe simulation time is not used as the app's retention calendar.
- An eligible record is archived only after an administrator confirms non-renewal, records a general reason and chooses a justified future review date. The backend verifies that the Stripe customer has no active or future schedules/subscriptions; a released schedule with an ongoing subscription is insufficient. This action does not cancel billing or settle debts.
- Archive flags, token invalidation and metadata audit are committed together. A failed audit rolls the action back. Archived members are excluded from the normal directory, registration JSON, dashboard, season-management list and regular CSV, including the full medical CSV. This changes the directory's total to mean non-archived registrations.
- Archive review shows only limited identifying/season/retention metadata, not health declarations or contacts. Ordinary member managers cannot access an archived member's invoice API by guessing their ID. Super Admin invoice access remains permission-checked and is logged before release.
- Holds may be set on active or archived records. They prevent the existing test-delete route from removing the record. Archive/restore preserve a hold; releasing it is a separate, reasoned and audited action. An archive is a restriction of use, so it is allowed while a hold preserves the data.
- Restore returns the record to normal views but does not recreate tokens, renew membership, remove holds or restart payments. An administrator can record a continued-retention review with a new justified review date while the record remains archived. Overdue reviews are visibly flagged.
- Permanent deletion is not provided in this workflow. The proposed twelve months is not silently adopted as policy and no review date authorises deletion. The old test-delete route is blocked for held/archived/season-history records. This is a technical retention control, not a declaration that the whole club is GDPR compliant.
- Returning from retention or season management resets the member directory to All members and clears filters, addressing the earlier confusion about a member disappearing from the filtered view.

## Apply in Development first

1. The package contains changed files under `TotalClubManagement/` and `TruDash/`. Copy each folder's contents into the matching repository, preserving the paths and comparing any later local edits. Do not replace whole repositories. Alternatively use the included incremental patch per repository after `git apply --check`; do not both copy and apply a patch.
2. Commit to the development branches. No new dependency, API key or routine Railway variable is required. Existing Microsoft/bridge/application permissions remain in use. Keep the current Stripe test-only restriction.
3. Deploy the TCM backend first with Prisma generation and the normal migration deployment step. From `backend`, run `npx --no-install prisma migrate deploy` against the intended DEVELOPMENT database. The committed migration is `20261015080000_add_member_archive`; it adds six optional columns and MemberRetentionAudit. It does not archive, delete or backfill anyone. Do not run `migrate reset`.
4. Deploy TruDash, sign in again if needed, and open **Membership pilot → Retention & archive**. There are no TCM public-frontend changes in this package. New archive guards affect both old and seasonal payment setup, so keep this backend version once using archives.
5. Back up and verify the target database as part of your normal deployment procedure. Production rollout and policy approval remain separate steps. Database owners and backup operators can still access stored data; archive restrictions do not replace platform access controls.

## Test normal controls with your existing test members

- As a Super Admin with MEMBERS_MANAGE, open Retention & archive. Check known confirmed seasons are displayed, with no medical or contact details.
- A 2026 / 27 member must remain ineligible until the real season end, even if you advanced their Stripe clock into July 2027. A member without an actual season confirmation must show Confirm actual season, not an inferred approval.
- An accepted future season must block archive. A future offer alone is not accepted renewal, but its season does not qualify as historical membership evidence either.
- Set a hold with a generic reason such as `Test case reference RET-001`. Verify ConsentForm.retentionHoldAt/reason and MemberRetentionAudit. Release it separately and verify another audit row. Do not put medical/complaint details into reason fields.
- Sign in as a member manager who is not a Super Admin. The retention area and `/api/membership-pilot/retention-review` must be unavailable/403. POST `/api/membership-pilot/retention/<id>/archive`, `/restore`, `/hold`, and `/review` must also be refused. Accounts without member-management permission remain blocked altogether.

## Test a successful archive now without altering real season dates

A synthetic fixture script is included because your actual season has not ended. It creates one fake, previously ended membership and NO Stripe customer, payment, invoice or subscription. It never changes an existing member and refuses to reset its fixture if already present.

Run it **locally from TCM/backend**, explicitly targeting your DEVELOPMENT database. Set local environment variables in PowerShell:

```powershell
$env:NODE_ENV = "development"
$env:RETENTION_FIXTURE_ENVIRONMENT = "development"
$env:RETENTION_FIXTURE_DATABASE_URL = "PASTE_THE_DEVELOPMENT_DATABASE_CONNECTION_URL_HERE"
node scripts/seed-retention-fixture.cjs --confirm-development-fixture
Remove-Item Env:RETENTION_FIXTURE_DATABASE_URL
Remove-Item Env:RETENTION_FIXTURE_ENVIRONMENT
```

Use the development database's externally accessible connection URL for your local machine, not `postgres.railway.internal` and not the Production connection. Do not paste that secret into chat, Git or screenshots. The script's three-part opt-in is to prevent accidental execution; it cannot independently identify which Railway environment a supplied URL belongs to.

Then:

1. Find **Archive Test Fixture**, team **GDPR ARCHIVE TEST**, in the directory and retention review. Its fake season ended before today's real date. It should be eligible for Review archive.
2. Set a hold and then choose Review archive. Enter a general reason, a future review date and explicitly confirm non-renewal. A hold should remain recorded after archiving.
3. Confirm that it disappears from the normal directory, ordinary registrations endpoint, season list and CSV. It should remain under Archived in the Super Admin retention area. In Postgres, check the archive fields and MemberRetentionAudit action ARCHIVED. The actual record remains stored.
4. As a non-Super member manager, request `/api/membership-pilot/registrations/gdpr-archive-development-fixture/invoices`. Expect 403. Try the old DELETE endpoint with confirmation: it must not remove an archived/held record, even for a Super Admin.
5. Use Record review, provide a continued-retention justification and a new date. Confirm ARCHIVE_REVIEWED is logged without restoring the member.
6. Restore with a reason. Confirm the member reappears, the hold remains, and no Stripe billing or renewal link is created. Check RESTORED in the audit. Release the hold explicitly if this test is complete.
7. To exercise the due-review badge, use local automated tests with an injected future date. Do not change real registrations, database dates or a production server clock simply to make them eligible. Advancing Stripe alone intentionally cannot age retention records.

## Validation and remaining decisions

Local validation: 52 TCM tests (including the previous billing/renewal regression suite), 3 TruDash bridge tests, both frontend builds, Prisma format/validate/generate, and all 11 migrations applied in isolated embedded PostgreSQL. The fixture's refusal without explicit opt-in was checked; it has not been run against your database. Live Railway/Stripe behaviour still needs your Development verification.

Run from each repository root:

```
# TCM, after installing backend dependencies
node --test tests/*.cjs
npm --prefix frontend run build
# TruDash
node --test tests/season-proxy.cjs
npm --prefix frontend run build
```

The club still needs approved category-specific retention periods, review ownership/frequency, hold-release authority, backup expiry/restore handling and a justified deletion/redaction process. Children’s medical declarations, membership evidence, financial invoices and safeguarding/legal cases should not all be assigned a blanket twelve months. This update preserves existing financial and health data rather than pretending that restricted archiving is deletion. Historical records with no confirmed membership season require further supervised confirmation before they can enter this workflow.

Other outstanding compliance work remains separate: confirm published notices and lawful bases, evidence of health-data consent across all enabled form paths, DPIA screening, processing records, supplier terms/transfers, M365/Railway security and backup checks, and tested subject-rights/breach procedures. Audit/log retention itself also needs an approved schedule. The changes do not certify legal compliance or inspect your deployed platform settings.
