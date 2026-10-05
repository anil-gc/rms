from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from threading import Barrier
from unittest import skipUnless
import uuid

from django.db import close_old_connections, connection, connections
from django.test import TransactionTestCase
from restaurant.errors import Conflict
from restaurant.models import Category, DiningTable, MenuItem, Payment, Ticket, User, Visit
from restaurant.services import pay_visit, submit_order, transition


@skipUnless(connection.vendor == "postgresql", "Row-lock concurrency requires PostgreSQL")
class ConcurrencyTests(TransactionTestCase):
    def setUp(self):
        self.user = User.objects.create_user("owner", role="owner")
        self.table = DiningTable.objects.create(name="Table 01")
        self.item = MenuItem.objects.create(name="Momo", price="100.10", category=Category.objects.create(name="Food"))

    def payload(self):
        return {"request_id": uuid.uuid4(), "table": self.table.id, "table_version": 0,
                "items": [{"menu_item": self.item.id, "quantity": 1, "expected_price": Decimal("100.10"), "note": ""}]}

    def race(self, *jobs):
        barrier = Barrier(len(jobs))
        def run(job):
            close_old_connections()
            try:
                barrier.wait(timeout=10)
                return job()
            except Conflict:
                return "conflict"
            finally:
                connections.close_all()
        with ThreadPoolExecutor(max_workers=len(jobs)) as pool:
            return list(pool.map(run, jobs))

    def served(self):
        ticket, _ = submit_order(self.user, self.payload())
        for action in ["approve", "prepare", "ready", "serve"]:
            transition(ticket.id, action, user=self.user)
        return ticket

    def test_same_order_submitted_simultaneously_is_created_once(self):
        payload = self.payload()
        results = self.race(lambda: submit_order(self.user, payload)[0].id, lambda: submit_order(self.user, payload)[0].id)
        self.assertEqual(results[0], results[1])
        self.assertEqual(Ticket.objects.count(), 1)
        self.assertEqual(Visit.objects.filter(closed_at=None).count(), 1)

    def test_two_rounds_open_only_one_visit(self):
        results = self.race(lambda: submit_order(self.user, self.payload())[0].visit_id, lambda: submit_order(self.user, self.payload())[0].visit_id)
        self.assertEqual(results[0], results[1])
        self.assertEqual(Ticket.objects.count(), 2)
        self.assertEqual(Visit.objects.count(), 1)

    def test_repeated_payment_is_saved_once(self):
        ticket = self.served()
        payload = {"request_id": uuid.uuid4(), "method": "cash", "expected_total": Decimal("100.10"), "qr_verified": False}
        results = self.race(lambda: pay_visit(self.user, ticket.visit_id, payload)[0].id, lambda: pay_visit(self.user, ticket.visit_id, payload)[0].id)
        self.assertEqual(results[0], results[1])
        self.assertEqual(Payment.objects.count(), 1)

    def test_two_cashiers_cannot_both_pay_same_visit(self):
        ticket = self.served()
        def pay():
            return pay_visit(self.user, ticket.visit_id, {"request_id": uuid.uuid4(), "method": "cash", "expected_total": Decimal("100.10"), "qr_verified": False})[0].id
        results = self.race(pay, pay)
        self.assertEqual(results.count("conflict"), 1)
        self.assertEqual(Payment.objects.count(), 1)

    def test_payment_racing_new_round_never_loses_food_or_money(self):
        ticket = self.served()
        payload = self.payload()
        results = self.race(
            lambda: pay_visit(self.user, ticket.visit_id, {"request_id": uuid.uuid4(), "method": "cash", "expected_total": Decimal("100.10"), "qr_verified": False})[0].id,
            lambda: submit_order(self.user, payload)[0].id,
        )
        self.assertEqual(results.count("conflict"), 1)
        if Payment.objects.exists():
            self.assertEqual(Ticket.objects.count(), 1)
            self.assertFalse(Visit.objects.filter(closed_at=None).exists())
        else:
            self.assertEqual(Ticket.objects.count(), 2)
            self.assertEqual(Visit.objects.filter(closed_at=None).count(), 1)

    def test_request_id_collision_across_tables_is_a_conflict(self):
        second_table = DiningTable.objects.create(name="Table 02")
        first = self.payload()
        second = {**first, "table": second_table.id}
        results = self.race(lambda: submit_order(self.user, first)[0].id, lambda: submit_order(self.user, second)[0].id)
        self.assertEqual(results.count("conflict"), 1)
        self.assertEqual(Ticket.objects.count(), 1)
        self.assertEqual(Visit.objects.count(), 1)

    def test_payment_id_collision_across_visits_is_a_conflict(self):
        first = self.served()
        self.table = DiningTable.objects.create(name="Table 02")
        second = self.served()
        payload = {"request_id": uuid.uuid4(), "method": "cash", "expected_total": Decimal("100.10"), "qr_verified": False}
        results = self.race(lambda: pay_visit(self.user, first.visit_id, payload)[0].id, lambda: pay_visit(self.user, second.visit_id, payload)[0].id)
        self.assertEqual(results.count("conflict"), 1)
        self.assertEqual(Payment.objects.count(), 1)
        self.assertEqual(Visit.objects.filter(closed_at=None).count(), 1)
