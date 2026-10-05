# Restaurant desk

A restaurant management application for one Nepali restaurant. Django + Django REST Framework, React + TypeScript and PostgreSQL. Simple English, Nepali menu text, NPR prices and Asia/Kathmandu reporting.

**Staff submits → billing approves → kitchen prepares → staff serves → cashier records payment.**

## Try the local demonstration

On Windows, from this folder:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-demo.ps1
```

Open **http://127.0.0.1:8000**. Accounts: `owner`, `billing`, `staff`. The default **demo-only** password is `Namaste-Demo-2026!`. Set `DEMO_PASSWORD` before first initialization to use a different password. Existing passwords are never reset by seeding.

The demo uses `demo.sqlite3`, is explicitly labelled as a demonstration, and cannot seed a PostgreSQL/production database. SQLite is for a single-computer preview; production and concurrency tests use PostgreSQL. Open separate browser profiles or private windows for each role. Multiple tabs in one profile share a login.

## Set up a real restaurant

Requirements: Python 3.12+, Node 22+, PostgreSQL 17+.

1. Create a virtual environment, install `requirements.lock`, and copy `.env.example` to `.env`.
2. Set a random `SECRET_KEY` and your PostgreSQL `DATABASE_URL`. Keep `DEBUG=true` only for local development.
3. In `frontend`, run `npm ci` and `npm run build`.
4. Run `python manage.py migrate`, `python manage.py collectstatic --noinput`, and `python manage.py createsuperuser`.
5. Run `python manage.py runserver 127.0.0.1:8000` for local development. Production uses the included Dockerfile and Gunicorn.
6. Sign in as the owner. In **Menu & setup**, enter restaurant details, add categories and menu items, add tables, and create individual staff/billing accounts.
7. Choose **Kitchen devices → Connect device**. Open the site on the kitchen tablet, choose **Connect kitchen screen**, and enter the one-use code within 10 minutes. Device access expires after 30 days and can be revoked immediately by the owner.

For a local PostgreSQL server with Docker, set `POSTGRES_PASSWORD`, run `docker compose up -d`, and point `DATABASE_URL` at the configured localhost database. Docker is optional if PostgreSQL is already installed. Do not use the demo accounts in production.

For frontend development, run `npm run dev` in `frontend` alongside Django. Open `http://127.0.0.1:5173/static/`; Vite proxies `/api/` to Django. The built app and API use one origin in production.

## Day-to-day guide

- **Staff:** select the actual table, tap menu items, add quantities/notes, review the table number and submit. Submitted orders are read-only; withdraw your pending order to replace a mistake. Mark ready food served after collecting it.
- **Billing / Gmode:** the persistent yellow alert shows orders awaiting approval. Review each ticket and send to kitchen, or reject with a reason. Open the table to see all rounds together. Collect payment only after all food is served.
- **Kitchen:** use Start preparing and Mark ready. Read cooking notes. Red cancellation tickets mean **do not prepare** and stay visible on the dedicated screen for 24 hours.
- **Owner:** manage people, menu, tables and devices; view Nepal-date sales and the action history. Only the owner can void approved tickets. Tell the cook directly if preparation has already started.
- **Payments:** cash and manually verified QR only. Check your merchant/bank account before confirming QR. Confirming payment closes the bill. Receipts can be reprinted from **Receipts**.
- **Printing:** select your 80 mm printer/paper in the browser print dialog, disable browser headers/footers, and use 100% scale. The receipt content is 72 mm wide with 4 mm margins. No tax invoicing, payment-provider connection or automatic cash drawer control is included.
- **Connection problems:** do not assume an order/payment succeeded unless the screen confirms it. Keep the screen open and use Check & retry after reconnecting. The same request identifier is reused and checked first to avoid duplicates. Drafts are kept in this browser tab's session storage; closing the tab, clearing browser data or private-session expiry can remove an unsubmitted draft. Saved orders remain on the server.
- **Empty bills:** billing can make a table available when every ticket was rejected, withdrawn or voided, without creating a payment.

## Deploy to Render

The included `render.yaml` defines a paid web service and paid PostgreSQL instance in Singapore. No cloud resources or charges are created by building this repository. Deployment needs a Git repository connected to your Render account.

1. Connect the repository as a Render Blueprint. Review the selected instance sizes and charges before creating resources.
2. Render generates `SECRET_KEY`, supplies the internal database URL and builds the Docker image. The pre-deploy command applies migrations and runs Django's production security checks. The web service serves React assets and `/api/v1/` under one HTTPS domain.
3. Create the initial owner through Render Shell: `python manage.py createsuperuser`. Configure the real restaurant in the application. No demo data is loaded.
4. For a custom domain, set `ALLOWED_HOSTS` and `CSRF_TRUSTED_ORIGINS` for that exact domain. The Render-provided hostname is detected automatically.
5. Configure daily exports as described below, perform a restoration drill, and test the actual phones, kitchen tablet and receipt printer before live service.

Health endpoint: `/health/` verifies database connectivity. Server exceptions and request logs go to standard output/error for Render logs. Logs do not deliberately include passwords or request bodies. Keep the service awake during restaurant hours; the blueprint selects paid compute.

Deployment references: [Django on Render](https://render.com/docs/deploy-django), [Blueprint fields](https://render.com/docs/blueprint-spec), [Django deployment checklist](https://docs.djangoproject.com/en/5.2/howto/deployment/checklist/).

## Backups and recovery

Paid Render PostgreSQL includes continuous point-in-time recovery; the recovery window depends on the workspace plan. It is separate from the explicit daily export below. See [Render's recovery documentation](https://render.com/docs/postgresql-backups).

- `ops/backup.py export backups/restaurant.dump` creates a consistent PostgreSQL snapshot plus a checksum/row fingerprint manifest. Set `DATABASE_URL` in the environment. Install matching PostgreSQL client tools; set `PG_BIN` when they are not on PATH.
- `ops/backup.py verify backups/restaurant.dump` restores only into a newly generated scratch database, compares every application table's row count and content fingerprints, then drops that scratch database. It never overwrites the source database. The verification database user must have `CREATEDB` permission.
- To enable daily retained exports, create a private S3 bucket with public access blocked, encryption enabled and a 30-day expiration lifecycle. Merge the service in `ops/render-backup.yaml` into the main blueprint. Set its bucket and restricted upload credentials. The schedule is **02:00 Nepal time daily**. The job stores encrypted dumps and manifests. Optional S3-compatible storage uses `S3_ENDPOINT_URL`.
- Daily backup jobs exit nonzero on failure. Enable failed-run alerts in your hosting account; confirm the first successful upload and perform a restore drill before live use. Credentials/storage are required to activate the job; the local build does not configure an external bucket.
- In an incident, stop ordering/payment access, recover to a **new** database using Render PITR or a verified backup, validate unpaid tables and latest receipts, then change the service database URL. Revoke/re-pair kitchen devices if recovered sessions are stale. Keep the original database until the owner confirms the recovered state.

Backups contain accounts and transaction records. Keep them private and out of version control. Never restore over a database containing live records.

## Verification

```powershell
$env:DEBUG='true'
$env:DATABASE_URL='postgresql://user:password@localhost:5432/restaurant'
$env:VERIFY_BACKUPS='1'
# If needed: $env:PG_BIN='C:\Program Files\PostgreSQL\18\bin'
.\.venv\Scripts\python.exe manage.py test restaurant.tests --verbosity 2
.\.venv\Scripts\python.exe manage.py makemigrations --check --dry-run
cd frontend
npm.cmd run build
```

Use a development database/user that can create test databases. Tests automatically use a separate `test_...` database. Concurrency tests skip on SQLite. Restore verification skips unless `VERIFY_BACKUPS=1` and PostgreSQL are configured. GitHub Actions runs backend, PostgreSQL concurrency, migration and production-build checks.

See `docs/VERIFICATION.md` for the actual local results and browser scenarios.

## Project map and boundaries

- `restaurant/`: data models, permissions, business transactions, API and tests.
- `frontend/src/`: role-specific screens, drafts, network reconciliation and receipt layout.
- `config/`, `Dockerfile`, `render.yaml`, `ops/`: configuration and operations.
- `docs/API.md`: request contracts and state transitions.

One restaurant, dine-in tables, one complete payment per bill and Gregorian dates in Nepal time. No inventory, supplier accounts, credit ledger, discounts, tax invoices, split payments, delivery or offline order processing. Physical printer and payment-account checks remain part of live setup.
