from decimal import Decimal
from django.contrib.auth.models import AbstractUser
from django.core.validators import MinValueValidator, MaxValueValidator
from django.db import models
from django.db.models import Q


class User(AbstractUser):
    class Role(models.TextChoices):
        OWNER = "owner", "Owner"
        BILLING = "billing", "Billing / Gmode"
        STAFF = "staff", "Staff"
    role = models.CharField(max_length=12, choices=Role.choices, default=Role.STAFF)

    @property
    def access_role(self):
        return self.Role.OWNER if self.is_superuser else self.role

    def save(self, *args, **kwargs):
        if self.is_superuser:
            self.role = self.Role.OWNER
        super().save(*args, **kwargs)


class RestaurantSettings(models.Model):
    name = models.CharField(max_length=120, default="Your restaurant")
    address = models.CharField(max_length=250, blank=True)
    phone = models.CharField(max_length=40, blank=True)
    receipt_footer = models.CharField(max_length=200, default="Thank you. Please visit again!")


class DiningTable(models.Model):
    name = models.CharField(max_length=40, unique=True)
    seats = models.PositiveSmallIntegerField(default=4, validators=[MinValueValidator(1), MaxValueValidator(30)])
    active = models.BooleanField(default=True)
    version = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["id"]


class Category(models.Model):
    name = models.CharField(max_length=80, unique=True)
    class Meta:
        ordering = ["id"]


class MenuItem(models.Model):
    category = models.ForeignKey(Category, on_delete=models.PROTECT, related_name="items")
    name = models.CharField(max_length=120)
    price = models.DecimalField(max_digits=10, decimal_places=2, validators=[MinValueValidator(Decimal("0.01"))])
    available = models.BooleanField(default=True)
    class Meta:
        ordering = ["id"]
        constraints = [models.CheckConstraint(condition=Q(price__gt=0), name="menu_price_positive")]


class Visit(models.Model):
    table = models.ForeignKey(DiningTable, on_delete=models.PROTECT, related_name="visits")
    opened_at = models.DateTimeField(auto_now_add=True)
    closed_at = models.DateTimeField(null=True, blank=True)
    class Meta:
        constraints = [models.UniqueConstraint(fields=["table"], condition=Q(closed_at__isnull=True), name="one_open_visit_per_table")]


class Ticket(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Waiting for approval"
        APPROVED = "approved", "Sent to kitchen"
        PREPARING = "preparing", "Preparing"
        READY = "ready", "Ready to serve"
        SERVED = "served", "Served"
        REJECTED = "rejected", "Rejected"
        WITHDRAWN = "withdrawn", "Withdrawn"
        VOIDED = "voided", "Cancelled by owner"
    visit = models.ForeignKey(Visit, on_delete=models.PROTECT, related_name="tickets")
    created_by = models.ForeignKey(User, on_delete=models.PROTECT)
    request_id = models.UUIDField()
    fingerprint = models.CharField(max_length=64)
    status = models.CharField(max_length=15, choices=Status.choices, default=Status.PENDING)
    reason = models.CharField(max_length=250, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    class Meta:
        ordering = ["created_at", "id"]
        constraints = [models.UniqueConstraint(fields=["created_by", "request_id"], name="unique_order_request")]
    @property
    def total(self):
        return sum((item.price * item.quantity for item in self.items.all()), Decimal("0.00"))


class TicketItem(models.Model):
    ticket = models.ForeignKey(Ticket, on_delete=models.CASCADE, related_name="items")
    menu_item = models.ForeignKey(MenuItem, on_delete=models.PROTECT)
    name = models.CharField(max_length=120)
    price = models.DecimalField(max_digits=10, decimal_places=2)
    quantity = models.PositiveSmallIntegerField(validators=[MinValueValidator(1), MaxValueValidator(99)])
    note = models.CharField(max_length=250, blank=True)
    class Meta:
        constraints = [models.CheckConstraint(condition=Q(quantity__gte=1) & Q(quantity__lte=99), name="valid_item_quantity")]


class Payment(models.Model):
    visit = models.OneToOneField(Visit, on_delete=models.PROTECT, related_name="payment")
    cashier = models.ForeignKey(User, on_delete=models.PROTECT)
    request_id = models.UUIDField(unique=True)
    method = models.CharField(max_length=10, choices=[("cash", "Cash"), ("qr", "QR")])
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    created_at = models.DateTimeField(auto_now_add=True)
    receipt = models.JSONField(default=dict)


class KitchenDevice(models.Model):
    name = models.CharField(max_length=80)
    token_hash = models.CharField(max_length=64, unique=True, null=True)
    pairing_hash = models.CharField(max_length=64, unique=True, null=True)
    pairing_expires_at = models.DateTimeField()
    paired_at = models.DateTimeField(null=True)
    revoked_at = models.DateTimeField(null=True)
    created_at = models.DateTimeField(auto_now_add=True)


class AuditEvent(models.Model):
    user = models.ForeignKey(User, on_delete=models.PROTECT, null=True)
    device = models.ForeignKey(KitchenDevice, on_delete=models.PROTECT, null=True)
    action = models.CharField(max_length=60)
    target = models.CharField(max_length=100)
    detail = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)
    class Meta:
        ordering = ["-created_at", "-id"]


class AuthRateBucket(models.Model):
    key = models.CharField(max_length=64, primary_key=True)
    started_at = models.DateTimeField()
    count = models.PositiveIntegerField(default=0)
