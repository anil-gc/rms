# Verification record

## Checks before first GitHub publication

Verified locally on 2026-10-05:

- **27 Django tests passed against PostgreSQL 18**, including concurrent orders, competing payments, access controls, CSRF, single-use kitchen pairing, Nepal-date reporting and receipt snapshots.
- The backup test exported a consistent database snapshot, restored it into a separate temporary database and compared table contents, including a completed payment and its receipt.
- `npm run build` passed TypeScript checking and produced the React production build.
- Django's production deployment checks passed with no warnings using production-style settings.
- Python dependency checks passed. No pending model migrations were detected.

## Browser checks from implementation

Separate Chromium sessions were used for owner, billing, staff and a paired kitchen device. Checks covered mobile order review at 390 pixels wide, a disconnected order submission followed by successful reconciliation/retry, billing approval before kitchen visibility, preparation/ready transitions, staff serving, and payment being disabled before serving. Desktop and mobile screenshots remain local under the ignored `output/playwright/` directory.

These checks do not establish complete browser coverage of checkout, response-loss payment recovery, physical printing or every owner setup form. Backend payment and retry behavior is covered by the automated tests above.

## Deployment boundaries

The Render configuration and daily-backup job definition are included, but neither has been deployed or activated. Docker-image execution, hosted backup uploads and physical receipt-printer output have not been verified. Local PostgreSQL tests used version 18; the deployment and GitHub Actions definitions target version 17. The backup restoration drill must also be repeated against the actual hosting setup before live restaurant use.

GitHub publication uploads source code; it does not publish a running restaurant website. Demo data, local databases, browser state, virtual environments, dependencies and build output are excluded from version control.
