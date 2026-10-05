import os
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from restaurant.models import Category, DiningTable, MenuItem, RestaurantSettings, User


class Command(BaseCommand):
    help = "Create isolated demonstration data. Requires DEBUG, LOCAL_DB=demo.sqlite3, no DATABASE_URL, and DEMO_PASSWORD."

    @transaction.atomic
    def handle(self, *args, **options):
        if not settings.DEBUG or os.environ.get("DATABASE_URL") or os.environ.get("LOCAL_DB") != "demo.sqlite3":
            raise CommandError("Demo data is allowed only in the separate local demo.sqlite3 database.")
        password = os.environ.get("DEMO_PASSWORD")
        if not password or len(password) < 12:
            raise CommandError("Set DEMO_PASSWORD to at least 12 characters.")
        RestaurantSettings.objects.update_or_create(pk=1, defaults={"name": "Namaste Kitchen · Demo", "address": "Demonstration restaurant", "receipt_footer": "Demo receipt — not a real transaction"})
        for username, role, name in [("owner", "owner", "Owner"), ("billing", "billing", "Cashier"), ("staff", "staff", "Waiter")]:
            user, created = User.objects.get_or_create(username=username, defaults={"role": role, "first_name": name})
            if created:
                user.set_password(password)
                user.save()
        for number in range(1, 9):
            DiningTable.objects.get_or_create(name=f"Table {number:02d}", defaults={"seats": 4 if number < 7 else 6})
        products = {"Momo": [("Veg momo · भेज मोमो", "160"), ("Chicken momo", "220"), ("Buff momo", "200")],
                    "Meals": [("Veg dal bhat", "280"), ("Chicken thali", "380"), ("Veg chowmein", "180")],
                    "Snacks": [("Aloo sadheko", "140"), ("Chicken sekuwa", "320")],
                    "Drinks": [("Milk tea · दूध चिया", "40"), ("Black tea", "30"), ("Fresh lemon soda", "100"), ("Bottled water", "30")]}
        for category_name, items in products.items():
            category, _ = Category.objects.get_or_create(name=category_name)
            for name, price in items:
                MenuItem.objects.get_or_create(name=name, category=category, defaults={"price": price})
        self.stdout.write(self.style.SUCCESS("Demo ready. Accounts: owner, billing, staff. Password comes from DEMO_PASSWORD."))
