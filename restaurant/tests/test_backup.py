import os
from pathlib import Path
import tempfile
import uuid
from decimal import Decimal
from unittest import skipUnless
from django.db import connection
from django.test import TransactionTestCase
from psycopg.conninfo import make_conninfo
from restaurant.models import Category, DiningTable, MenuItem, RestaurantSettings, User
from ops.backup import export_backup, verify_backup
from restaurant.services import submit_order, transition, pay_visit


@skipUnless(connection.vendor == "postgresql" and os.environ.get("VERIFY_BACKUPS") == "1", "Set VERIFY_BACKUPS=1 with PostgreSQL client tools to run the restore drill")
class BackupTests(TransactionTestCase):
    def test_export_and_restore_matches_every_source_row(self):
        RestaurantSettings.objects.create(name="Backup verification restaurant")
        user = User.objects.create_user("backup-test", password="test-only-password", role="owner")
        table = DiningTable.objects.create(name="Table 01")
        item = MenuItem.objects.create(name="Veg momo · मोमो", price="199.99", category=Category.objects.create(name="Momo"))
        ticket, _ = submit_order(user, {"request_id": uuid.uuid4(), "table": table.id, "table_version": 0, "items": [{"menu_item": item.id, "expected_price": Decimal("199.99"), "quantity": 2, "note": "Restore this note"}]})
        for action in ["approve", "prepare", "ready", "serve"]:
            transition(ticket.id, action, user=user)
        pay_visit(user, ticket.visit_id, {"request_id": uuid.uuid4(), "method": "qr", "expected_total": Decimal("399.98"), "qr_verified": True})
        params = connection.get_connection_params()
        url = make_conninfo(**{k: v for k, v in params.items() if k in {"dbname", "user", "password", "host", "port", "sslmode"}})
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "restore-test.dump"
            export_backup(url, path)
            result = verify_backup(url, path)
            self.assertEqual(result["status"], "verified")
            self.assertGreater(result["tables"], 10)
            self.assertGreater(result["rows"], 5)
        self.assertTrue(User.objects.filter(username="backup-test").exists())
