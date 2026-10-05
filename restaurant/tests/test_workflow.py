import uuid
from datetime import datetime, timedelta, timezone as dt_timezone
from decimal import Decimal

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from restaurant.models import AuditEvent, Category, DiningTable, KitchenDevice, MenuItem, Payment, RestaurantSettings, Ticket, User, Visit


class WorkflowTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.owner = User.objects.create_user("owner", password="Strong-secret-928!", role="owner")
        cls.billing = User.objects.create_user("billing", password="Strong-secret-928!", role="billing")
        cls.staff = User.objects.create_user("staff", password="Strong-secret-928!", role="staff")
        cls.other_staff = User.objects.create_user("staff2", password="Strong-secret-928!", role="staff")
        cls.table = DiningTable.objects.create(name="Table 01")
        category = Category.objects.create(name="Momo")
        cls.product = MenuItem.objects.create(category=category, name="Veg momo · भेज मोमो", price=Decimal("160.25"))
        RestaurantSettings.objects.create(pk=1, name="Test Restaurant", address="Test address")

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.staff)
        self.cashier = APIClient()
        self.cashier.force_authenticate(self.billing)
        self.admin = APIClient()
        self.admin.force_authenticate(self.owner)
        self.kitchen = APIClient()
        response = self.admin.post("/api/v1/management/devices/", {"name": "Main kitchen"}, format="json")
        self.code = response.data["code"]
        self.device_id = response.data["id"]
        self.assertEqual(self.kitchen.post("/api/v1/kitchen/pair/", {"code": self.code}).status_code, 200)

    def payload(self, **overrides):
        return {"request_id": str(uuid.uuid4()), "table": self.table.id, "table_version": 0,
                "items": [{"menu_item": self.product.id, "quantity": 2, "expected_price": "160.25", "note": "Less spicy"}], **overrides}

    def order(self, payload=None):
        response = self.client.post("/api/v1/orders/", payload or self.payload(), format="json")
        self.assertEqual(response.status_code, 201, response.data)
        return response.data

    def serve(self, order):
        self.assertEqual(self.cashier.post(f"/api/v1/orders/{order['id']}/approve/").status_code, 200)
        self.assertEqual(self.kitchen.post(f"/api/v1/kitchen/orders/{order['id']}/prepare/").status_code, 200)
        self.assertEqual(self.kitchen.post(f"/api/v1/kitchen/orders/{order['id']}/ready/").status_code, 200)
        self.assertEqual(self.client.post(f"/api/v1/orders/{order['id']}/serve/").status_code, 200)

    def pay(self, order, **overrides):
        payload = {"request_id": str(uuid.uuid4()), "method": "cash", "expected_total": "320.50", **overrides}
        return self.cashier.post(f"/api/v1/visits/{order['visit']}/payment/", payload, format="json"), payload

    def test_full_flow_and_immutable_receipt(self):
        order = self.order()
        self.assertEqual(self.kitchen.get("/api/v1/kitchen/queue/").data, [])
        self.assertEqual(self.pay(order)[0].status_code, 409)
        self.serve(order)
        result, _ = self.pay(order)
        self.assertEqual(result.status_code, 201, result.data)
        self.assertEqual(result.data["total"], "320.50")
        self.assertEqual(result.data["items"][0]["price"], "160.25")
        self.assertEqual(result.data["table"], "Table 01")
        self.assertTrue(result.data["number"].startswith("R-"))
        self.assertIsNotNone(Visit.objects.get(pk=order["visit"]).closed_at)
        state = self.client.get("/api/v1/state/").data
        self.assertIsNone(state["tables"][0]["visit"])
        self.assertEqual(state["tables"][0]["version"], 1)
        RestaurantSettings.objects.filter(pk=1).update(name="Renamed Restaurant")
        MenuItem.objects.filter(pk=self.product.id).update(price="999.00", name="Renamed")
        self.assertEqual(self.cashier.get(f"/api/v1/receipts/{result.data['id']}/").data, result.data)
        sales = self.admin.get("/api/v1/reports/daily/").data
        self.assertEqual((sales["count"], sales["total"], sales["cash"], sales["qr"]), (1, "320.50", "320.50", "0.00"))

    def test_additional_rounds_require_fresh_approval_and_same_visit(self):
        first = self.order(); self.serve(first)
        second = self.order()
        self.assertEqual(first["visit"], second["visit"])
        self.assertEqual(self.pay(first, expected_total="641.00")[0].status_code, 409)
        self.serve(second)
        paid, _ = self.pay(first, expected_total="641.00")
        self.assertEqual(paid.status_code, 201)
        self.assertEqual(paid.data["total"], "641.00")

    def test_order_retry_and_changed_payload_conflict(self):
        payload = self.payload(); order = self.order(payload)
        repeat = self.client.post("/api/v1/orders/", payload, format="json")
        self.assertEqual(repeat.status_code, 200)
        self.assertEqual(repeat.data["id"], order["id"])
        self.assertEqual(Ticket.objects.count(), 1)
        payload["items"][0]["quantity"] = 3
        self.assertEqual(self.client.post("/api/v1/orders/", payload, format="json").status_code, 409)
        result = self.client.get(f"/api/v1/orders/requests/{payload['request_id']}/")
        self.assertEqual(result.data["id"], order["id"])
        self.assertEqual(self.cashier.get(f"/api/v1/orders/requests/{payload['request_id']}/").status_code, 404)

    def test_retry_after_bill_closed_returns_original_order(self):
        payload = self.payload(); order = self.order(payload); self.serve(order); self.pay(order)
        replay = self.client.post("/api/v1/orders/", payload, format="json")
        self.assertEqual(replay.status_code, 200)
        self.assertEqual(replay.data["id"], order["id"])
        self.assertEqual(Visit.objects.count(), 1)

    def test_payment_retry_and_different_key_cannot_charge_twice(self):
        order = self.order(); self.serve(order)
        result, payload = self.pay(order)
        repeat = self.cashier.post(f"/api/v1/visits/{order['visit']}/payment/", payload, format="json")
        self.assertEqual(repeat.status_code, 200)
        self.assertEqual(result.data, repeat.data)
        self.assertEqual(self.pay(order)[0].status_code, 409)
        self.assertEqual(Payment.objects.count(), 1)
        self.assertEqual(self.cashier.get(f"/api/v1/payments/requests/{payload['request_id']}/").data, result.data)
        payload["method"] = "qr"
        self.assertEqual(self.cashier.post(f"/api/v1/visits/{order['visit']}/payment/", payload, format="json").status_code, 409)

    def test_qr_requires_explicit_verification(self):
        order = self.order(); self.serve(order)
        self.assertEqual(self.pay(order, method="qr")[0].status_code, 400)
        result, _ = self.pay(order, method="qr", qr_verified=True)
        self.assertEqual(result.status_code, 201)
        self.assertEqual(result.data["method"], "qr")

    def test_staff_and_device_permissions(self):
        order = self.order()
        for path in ["management/", "reports/daily/", "receipts/", "kitchen/queue/"]:
            self.assertEqual(self.client.get(f"/api/v1/{path}").status_code, 403, path)
        for path in ["state/", "management/", "reports/daily/", "receipts/"]:
            self.assertIn(self.kitchen.get(f"/api/v1/{path}").status_code, [401, 403], path)
        self.assertEqual(self.client.post(f"/api/v1/orders/{order['id']}/approve/").status_code, 403)
        self.assertEqual(self.client.post(f"/api/v1/visits/{order['visit']}/payment/", {}).status_code, 403)
        self.assertEqual(self.kitchen.post(f"/api/v1/kitchen/orders/{order['id']}/approve/").status_code, 403)
        self.assertEqual(self.cashier.post(f"/api/v1/orders/{order['id']}/void/", {"reason": "Test"}).status_code, 403)
        self.cashier.post(f"/api/v1/orders/{order['id']}/approve/")
        kitchen_order = self.kitchen.get("/api/v1/kitchen/queue/").data[0]
        self.assertNotIn("total", kitchen_order)
        self.assertNotIn("price", kitchen_order["items"][0])
        self.assertNotIn("staff_name", kitchen_order)

    def test_reject_withdraw_void_and_close_empty(self):
        a = self.order()
        self.assertEqual(self.cashier.post(f"/api/v1/orders/{a['id']}/reject/", {"reason": ""}).status_code, 400)
        self.assertEqual(self.cashier.post(f"/api/v1/orders/{a['id']}/reject/", {"reason": "Wrong table"}).status_code, 200)
        b = self.order()
        self.assertEqual(self.client.post(f"/api/v1/orders/{b['id']}/withdraw/").status_code, 200)
        c = self.order(); self.cashier.post(f"/api/v1/orders/{c['id']}/approve/")
        self.assertEqual(self.admin.post(f"/api/v1/orders/{c['id']}/void/", {"reason": "Guest cancelled"}).status_code, 200)
        self.assertEqual(self.kitchen.get("/api/v1/kitchen/queue/").data[0]["reason"], "Guest cancelled")
        state = self.client.get("/api/v1/state/").data["tables"][0]
        self.assertEqual(Decimal(state["total"]), 0)
        self.assertTrue(state["can_close_empty"])
        self.assertEqual(self.cashier.post(f"/api/v1/visits/{a['visit']}/close-empty/").status_code, 200)
        self.assertEqual(self.kitchen.get("/api/v1/kitchen/queue/").data[0]["status"], "voided")
        self.assertEqual(Payment.objects.count(), 0)

    def test_staff_cannot_withdraw_someone_elses_order(self):
        order = self.order(); self.client.force_authenticate(self.other_staff)
        self.assertEqual(self.client.post(f"/api/v1/orders/{order['id']}/withdraw/").status_code, 403)

    def test_stale_table_menu_and_bill_are_rejected(self):
        self.assertEqual(self.client.post("/api/v1/orders/", self.payload(table_version=9), format="json").status_code, 409)
        bad_price = self.payload(); bad_price["items"][0]["expected_price"] = "10.00"
        self.assertEqual(self.client.post("/api/v1/orders/", bad_price, format="json").status_code, 409)
        order = self.order(); self.serve(order)
        self.assertEqual(self.pay(order, expected_total="1.00")[0].status_code, 409)
        self.pay(order)
        self.assertEqual(self.client.post("/api/v1/orders/", self.payload(), format="json").status_code, 409)
        MenuItem.objects.filter(pk=self.product.id).update(available=False)
        self.assertEqual(self.client.post("/api/v1/orders/", self.payload(table_version=1), format="json").status_code, 409)

    def test_price_snapshot_survives_menu_changes(self):
        order = self.order()
        MenuItem.objects.filter(pk=self.product.id).update(price="999.00", name="Changed name")
        self.serve(order)
        response, _ = self.pay(order)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["items"][0]["price"], "160.25")
        self.assertIn("मोमो", response.data["items"][0]["name"])

    def test_illegal_transitions_and_repeated_actions(self):
        order = self.order()
        self.assertEqual(self.client.post(f"/api/v1/orders/{order['id']}/serve/").status_code, 409)
        self.assertEqual(self.kitchen.post(f"/api/v1/kitchen/orders/{order['id']}/ready/").status_code, 409)
        self.cashier.post(f"/api/v1/orders/{order['id']}/approve/")
        self.assertEqual(self.cashier.post(f"/api/v1/orders/{order['id']}/approve/").status_code, 200)
        self.assertEqual(AuditEvent.objects.filter(action="order_approve").count(), 1)
        self.assertEqual(self.client.post(f"/api/v1/orders/{order['id']}/withdraw/").status_code, 409)

    def test_pairing_is_single_use_expires_and_revokes(self):
        stranger = APIClient()
        self.assertEqual(stranger.post("/api/v1/kitchen/pair/", {"code": self.code}).status_code, 400)
        created = self.admin.post("/api/v1/management/devices/", {"name": "Second"}, format="json").data
        KitchenDevice.objects.filter(pk=created["id"]).update(pairing_expires_at=timezone.now() - timedelta(seconds=1))
        self.assertEqual(stranger.post("/api/v1/kitchen/pair/", {"code": created["code"]}).status_code, 400)
        self.assertEqual(self.admin.post(f"/api/v1/management/devices/{self.device_id}/revoke/").status_code, 200)
        self.assertIn(self.kitchen.get("/api/v1/kitchen/queue/").status_code, [401, 403])

    def test_nepal_day_boundary(self):
        order = self.order(); self.serve(order); self.pay(order)
        Payment.objects.update(created_at=datetime(2026, 9, 23, 18, 20, tzinfo=dt_timezone.utc))
        self.assertEqual(self.admin.get("/api/v1/reports/daily/?date=2026-09-24").data["count"], 1)
        self.assertEqual(self.admin.get("/api/v1/reports/daily/?date=2026-09-23").data["count"], 0)
        self.assertEqual(self.admin.get("/api/v1/reports/daily/?date=invalid").status_code, 400)

    def test_owner_settings_users_and_protected_tables(self):
        self.order()
        self.assertEqual(self.admin.patch(f"/api/v1/management/tables/{self.table.id}/", {"active": False}, format="json").status_code, 409)
        self.assertEqual(self.admin.patch(f"/api/v1/management/tables/{self.table.id}/", {"name": "New"}, format="json").status_code, 409)
        self.assertEqual(self.admin.patch(f"/api/v1/management/users/{self.owner.id}/", {"role": "staff"}, format="json").status_code, 400)
        self.assertEqual(self.admin.post("/api/v1/management/users/", {"username": "new", "password": "123", "role": "staff"}, format="json").status_code, 400)
        result = self.admin.post("/api/v1/management/users/", {"username": "new", "password": "Safe-password-829!", "role": "staff"}, format="json")
        self.assertEqual(result.status_code, 201, result.data)
        self.assertNotIn("password", result.data)
        self.assertTrue(User.objects.get(username="new").check_password("Safe-password-829!"))

    def test_invalid_quantities_and_empty_order(self):
        self.assertEqual(self.client.post("/api/v1/orders/", self.payload(items=[]), format="json").status_code, 400)
        for quantity in [0, -1, 100, 1.5]:
            data = self.payload(); data["items"][0]["quantity"] = quantity
            self.assertEqual(self.client.post("/api/v1/orders/", data, format="json").status_code, 400)
        self.assertEqual(Ticket.objects.count(), 0)

    def test_login_csrf_and_device_csrf_are_enforced(self):
        client = APIClient(enforce_csrf_checks=True)
        credentials = {"username": "staff", "password": "Strong-secret-928!"}
        self.assertEqual(client.post("/api/v1/auth/login/", credentials).status_code, 403)
        token = client.get("/api/v1/auth/session/").data["csrf_token"]
        self.assertEqual(client.post("/api/v1/auth/login/", credentials, HTTP_X_CSRFTOKEN=token).status_code, 200)
        self.assertEqual(client.post("/api/v1/orders/", self.payload(), format="json").status_code, 403)
        session = client.get("/api/v1/auth/session/").data
        self.assertEqual(session["user"]["role"], "staff")
        self.assertEqual(client.post("/api/v1/auth/logout/", {}, HTTP_X_CSRFTOKEN=session["csrf_token"]).status_code, 200)
        created = self.admin.post("/api/v1/management/devices/", {"name": "CSRF kitchen"}, format="json").data
        self.assertEqual(client.post("/api/v1/kitchen/pair/", {"code": created["code"]}).status_code, 403)
        token = client.get("/api/v1/auth/session/").data["csrf_token"]
        self.assertEqual(client.post("/api/v1/kitchen/pair/", {"code": created["code"]}, HTTP_X_CSRFTOKEN=token).status_code, 200)
        order = self.order(); self.cashier.post(f"/api/v1/orders/{order['id']}/approve/")
        self.assertEqual(client.post(f"/api/v1/kitchen/orders/{order['id']}/prepare/").status_code, 403)

    def test_auth_rate_limit_and_disabled_user(self):
        stranger = APIClient()
        for _ in range(15):
            self.assertEqual(stranger.post("/api/v1/auth/login/", {"username": "staff", "password": "wrong"}).status_code, 400)
        self.assertEqual(stranger.post("/api/v1/auth/login/", {"username": "staff", "password": "wrong"}).status_code, 429)
        User.objects.filter(pk=self.staff.id).update(is_active=False)
        other = APIClient(REMOTE_ADDR="10.0.0.3")
        self.assertEqual(other.post("/api/v1/auth/login/", {"username": "staff", "password": "Strong-secret-928!"}).status_code, 400)

    def test_created_superuser_has_owner_access_and_role(self):
        owner = User.objects.create_superuser("initial", password="Strong-secret-928!")
        self.assertEqual(owner.role, "owner")
        client = APIClient()
        client.force_authenticate(owner)
        result = client.get("/api/v1/management/")
        self.assertEqual(result.status_code, 200)
        self.assertEqual(next(u for u in result.data["users"] if u["id"] == owner.id)["role"], "owner")
