# API contract

All endpoints use `/api/v1/`. Django session cookies authenticate users. Fetch `GET auth/session/` to get the current identity and `csrf_token`, then supply `X-CSRFToken` on every mutation, including login and kitchen pairing. Fetch a fresh token after login/logout/pairing. JSON responses are private and not cacheable. Role checks are server-side. Kitchen sessions authenticate only kitchen routes.

## Access

`owner`: all restaurant operations; `billing`: orders, table bills and receipts; `staff`: menu, active tables, order submission/status and serving. The initial Django superuser always has owner access. Public self-registration is not supported. Kitchen-device sessions cannot call staff, financial or owner routes.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `auth/session/` | User/device identity and CSRF token |
| POST | `auth/login/` | `{username, password}`; rate limited |
| POST | `auth/logout/` | End session |
| GET | `state/` | Active tables/visits, tickets, menu, categories and restaurant details |
| POST | `orders/` | Submit an immutable order round |
| GET | `orders/requests/{uuid}/` | Reconcile caller's submission |
| POST | `orders/{id}/{action}/` | approve, reject, withdraw, prepare, ready, serve, void; action-specific roles apply |
| POST | `visits/{id}/payment/` | Settle the complete served bill |
| POST | `visits/{id}/close-empty/` | Close a visit with only excluded tickets |
| GET | `payments/requests/{uuid}/` | Reconcile caller's payment |
| GET | `receipts/` | Latest 100 completed receipts |
| GET | `receipts/{id}/` | Immutable receipt snapshot |
| GET | `reports/daily/?date=YYYY-MM-DD` | Owner report; defaults to today in Nepal |
| POST | `kitchen/pair/` | `{code}`; one use within ten minutes, rate limited |
| GET | `kitchen/queue/` | Approved/preparing/ready tickets, plus cancellations from the last 24 hours; excludes prices |
| POST | `kitchen/orders/{id}/prepare/` | Start preparing |
| POST | `kitchen/orders/{id}/ready/` | Mark ready |
| GET | `management/` | Owner configuration and latest 100 audit entries |
| POST/PATCH | `management/{resource}/[{id}/]` | Create/update categories, menu, tables and users; settings uses PATCH to `settings/1/` |
| POST | `management/devices/` | `{name}`; return pairing code once |
| POST | `management/devices/{id}/revoke/` | Immediately revoke device access |

## Order submission

```json
{
  "request_id": "f08cb68d-e1c1-4898-8665-a62c3b1bdf76",
  "table": 1,
  "table_version": 0,
  "items": [{"menu_item": 3, "quantity": 2, "expected_price": "160.00", "note": "Less spicy"}]
}
```

The server snapshots name/price from the menu. `expected_price` detects menu changes; it never sets the charged price. Quantity is an integer from 1 to 99; notes/reasons are at most 250 characters. An order has 1–100 lines. `table_version` increments whenever the visit closes, preventing old drafts being charged to new guests.

Each user's request UUID is unique. An identical retry returns the existing order even after the visit closes; reuse for a different payload returns 409. Reconciliation returns 404 only when no order exists under that caller/request. After uncertain delivery, keep the exact original request UUID and payload.

Transitions: `pending → approved → preparing → ready → served`. Billing/owner can approve or reject pending tickets. Staff can withdraw only their own pending tickets. Owner can withdraw any pending ticket and void approved/preparing/ready/served tickets with a reason. Kitchen devices can only prepare/ready. Staff/billing/owner can mark ready tickets served. Repeated same-state actions are harmless. Illegal or stale transitions return 409.

## Payment

```json
{
  "request_id": "e4f3019f-07aa-4ef6-b7d5-4015c22800c0",
  "method": "qr",
  "expected_total": "320.00",
  "qr_verified": true
}
```

For cash, set `method` to `cash`. The server sums non-excluded tickets using decimal arithmetic; every billable ticket must be served. A stale total, pending round, closed visit or competing payment returns 409. QR requires `qr_verified=true`. A successful 201 returns the immutable receipt; an identical caller/request retry returns the same receipt with 200. No provider payment is initiated by this application.

Table row locks serialize submission, state transitions, empty closure and payment. Partial unique constraints guarantee one open visit per table; a one-to-one payment constraint guarantees one settled bill per visit. PostgreSQL is mandatory outside DEBUG. Receipts include saved restaurant details and line prices rather than joining current menu data.

## Failures and client behavior

400 means invalid input; 401/403 means missing session, wrong role or CSRF failure; 404 means unknown record/request; 409 means refresh and review changed data; 429 means wait before another login/pair attempt. Errors include `detail`. Mutation success is never inferred from a timeout or disconnect.

Active clients poll at 3-second intervals while visible and refresh on reconnection/visibility changes. This is an open-screen service, not a background push-notification service. Browser sound must be enabled by the user. A closed/backgrounded phone may not receive timely notifications until reopened.
