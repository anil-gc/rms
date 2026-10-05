import hashlib
import json
import secrets
from datetime import timedelta
from decimal import Decimal

from django.db import IntegrityError, transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError, Throttled

from .errors import Conflict
from .models import AuditEvent, AuthRateBucket, DiningTable, KitchenDevice, MenuItem, Payment, RestaurantSettings, Ticket, TicketItem, Visit

EXCLUDED = [Ticket.Status.REJECTED, Ticket.Status.WITHDRAWN, Ticket.Status.VOIDED]


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def audit(action, target, user=None, device=None, **detail):
    AuditEvent.objects.create(action=action, target=str(target), user=user, device=device, detail=detail)


def throttle(request, scope, limit=15):
    key = digest(f"{scope}:{request.META.get('REMOTE_ADDR', '')}")
    now = timezone.now()
    with transaction.atomic():
        bucket, _ = AuthRateBucket.objects.get_or_create(key=key, defaults={"started_at": now})
        bucket = AuthRateBucket.objects.select_for_update().get(pk=key)
        if bucket.started_at < now - timedelta(minutes=1):
            bucket.started_at, bucket.count = now, 0
        bucket.count += 1
        bucket.save()
        blocked = bucket.count > limit
    if blocked:
        raise Throttled(wait=60, detail="Too many attempts. Please wait a minute.")


def ticket_data(ticket, kitchen=False):
    items = []
    for item in ticket.items.all():
        data = {"id": item.id, "menu_item": item.menu_item_id, "name": item.name, "quantity": item.quantity, "note": item.note}
        if not kitchen:
            data.update(price=str(item.price), total=str(item.price * item.quantity))
        items.append(data)
    data = {
        "id": ticket.id, "visit": ticket.visit_id, "table": ticket.visit.table_id,
        "table_name": ticket.visit.table.name, "status": ticket.status, "reason": ticket.reason,
        "created_at": ticket.created_at.isoformat(), "updated_at": ticket.updated_at.isoformat(), "items": items,
    }
    if not kitchen:
        data.update(total=str(ticket.total), created_by=ticket.created_by_id, staff_name=ticket.created_by.first_name or ticket.created_by.username, request_id=str(ticket.request_id))
    return data


def tickets_query():
    return Ticket.objects.select_related("visit__table", "created_by").prefetch_related("items")


def request_fingerprint(data):
    return digest(json.dumps({k: v for k, v in data.items() if k != "request_id"}, sort_keys=True, default=str))


def replay_ticket(user, data):
    ticket = tickets_query().filter(created_by=user, request_id=data["request_id"]).first()
    if ticket and ticket.fingerprint != request_fingerprint(data):
        raise Conflict("This request was already used for a different order. Refresh before submitting.")
    return ticket


@transaction.atomic
def submit_order(user, data):
    existing = replay_ticket(user, data)
    if existing:
        return existing, False
    table = get_object_or_404(DiningTable.objects.select_for_update(), pk=data["table"])
    existing = replay_ticket(user, data)
    if existing:
        return existing, False
    if not table.active or table.version != data["table_version"]:
        raise Conflict("This table has changed or its previous bill was closed. Review the table before submitting again.")
    ids = [item["menu_item"] for item in data["items"]]
    menu = {m.id: m for m in MenuItem.objects.filter(id__in=ids)}
    for item in data["items"]:
        product = menu.get(item["menu_item"])
        if not product or not product.available:
            raise Conflict("An item is no longer available. Review your order.")
        if product.price != item["expected_price"]:
            raise Conflict(f"The price of {product.name} changed. Review your order.")
    visit, _ = Visit.objects.get_or_create(table=table, closed_at=None)
    try:
        with transaction.atomic():
            ticket = Ticket.objects.create(visit=visit, created_by=user, request_id=data["request_id"], fingerprint=request_fingerprint(data))
    except IntegrityError:
        raise Conflict("This request was already used for another order. Refresh before submitting.")
    TicketItem.objects.bulk_create([
        TicketItem(ticket=ticket, menu_item=menu[item["menu_item"]], name=menu[item["menu_item"]].name,
                   price=menu[item["menu_item"]].price, quantity=item["quantity"], note=item["note"])
        for item in data["items"]
    ])
    audit("order_submitted", ticket.id, user=user, table=table.name)
    return tickets_query().get(pk=ticket.pk), True


TRANSITIONS = {
    "approve": ([Ticket.Status.PENDING], Ticket.Status.APPROVED, {"owner", "billing"}),
    "reject": ([Ticket.Status.PENDING], Ticket.Status.REJECTED, {"owner", "billing"}),
    "withdraw": ([Ticket.Status.PENDING], Ticket.Status.WITHDRAWN, {"owner", "billing", "staff"}),
    "prepare": ([Ticket.Status.APPROVED], Ticket.Status.PREPARING, {"owner", "kitchen"}),
    "ready": ([Ticket.Status.PREPARING], Ticket.Status.READY, {"owner", "kitchen"}),
    "serve": ([Ticket.Status.READY], Ticket.Status.SERVED, {"owner", "billing", "staff"}),
    "void": ([Ticket.Status.APPROVED, Ticket.Status.PREPARING, Ticket.Status.READY, Ticket.Status.SERVED], Ticket.Status.VOIDED, {"owner"}),
}


@transaction.atomic
def transition(ticket_id, action, user=None, device=None, reason=""):
    if action not in TRANSITIONS:
        raise ValidationError("Unknown order action.")
    allowed_from, target, roles = TRANSITIONS[action]
    role = "kitchen" if device else user.access_role
    if role not in roles:
        raise PermissionDenied("You do not have access to this action.")
    initial = get_object_or_404(Ticket.objects.select_related("visit"), pk=ticket_id)
    DiningTable.objects.select_for_update().get(pk=initial.visit.table_id)
    ticket = tickets_query().get(pk=ticket_id)
    if action == "withdraw" and role == "staff" and ticket.created_by_id != user.id:
        raise PermissionDenied("You can only withdraw your own orders.")
    if ticket.status == target:
        return ticket
    if ticket.visit.closed_at or ticket.status not in allowed_from:
        raise Conflict("This order has changed. Refresh to see its current status.")
    if action in {"reject", "void"} and not reason.strip():
        raise ValidationError("Please provide a reason.")
    ticket.status, ticket.reason = target, reason.strip()
    ticket.save(update_fields=["status", "reason", "updated_at"])
    audit(f"order_{action}", ticket.id, user=user, device=device, reason=reason)
    return ticket


@transaction.atomic
def pay_visit(user, visit_id, data):
    initial = get_object_or_404(Visit, pk=visit_id)
    table = DiningTable.objects.select_for_update().get(pk=initial.table_id)
    visit = Visit.objects.get(pk=visit_id)
    existing = Payment.objects.filter(request_id=data["request_id"]).first()
    if existing:
        if existing.visit_id != visit.id or existing.method != data["method"] or existing.amount != data["expected_total"] or existing.cashier_id != user.id:
            raise Conflict("This payment request was already used. Refresh the bill.")
        return existing, False
    if visit.closed_at or Payment.objects.filter(visit=visit).exists():
        raise Conflict("This bill is already closed. Check receipt history before collecting payment.")
    active_tickets = tickets_query().filter(visit=visit).exclude(status__in=EXCLUDED)
    if not active_tickets.exists() or active_tickets.exclude(status=Ticket.Status.SERVED).exists():
        raise Conflict("All orders must be approved and served before collecting payment.")
    total = sum((ticket.total for ticket in active_tickets), Decimal("0.00"))
    if total != data["expected_total"]:
        raise Conflict("The bill changed. Review the latest total before collecting payment.")
    if data["method"] == "qr" and not data["qr_verified"]:
        raise ValidationError("Verify the QR payment in your payment account before confirming.")
    if total <= 0:
        raise ValidationError("The bill must have a positive total.")
    try:
        with transaction.atomic():
            payment = Payment.objects.create(visit=visit, cashier=user, request_id=data["request_id"], method=data["method"], amount=total)
    except IntegrityError:
        raise Conflict("This payment request was already used. Refresh the bill.")
    restaurant, _ = RestaurantSettings.objects.get_or_create(pk=1)
    local_time = timezone.localtime(payment.created_at)
    payment.receipt = {
        "id": payment.id, "number": f"R-{local_time:%Y%m%d}-{payment.id:06d}",
        "restaurant": {"name": restaurant.name, "address": restaurant.address, "phone": restaurant.phone, "footer": restaurant.receipt_footer},
        "table": table.name, "created_at": payment.created_at.isoformat(), "cashier": user.first_name or user.username,
        "method": payment.method, "total": str(total),
        "items": [{"name": item.name, "price": str(item.price), "quantity": item.quantity, "total": str(item.price * item.quantity)} for ticket in active_tickets for item in ticket.items.all()],
    }
    payment.save(update_fields=["receipt"])
    visit.closed_at = timezone.now()
    visit.save(update_fields=["closed_at"])
    table.version += 1
    table.save(update_fields=["version"])
    audit("payment_recorded", payment.id, user=user, amount=str(total), method=payment.method)
    return payment, True


@transaction.atomic
def close_empty_visit(user, visit_id):
    initial = get_object_or_404(Visit, pk=visit_id)
    table = DiningTable.objects.select_for_update().get(pk=initial.table_id)
    visit = Visit.objects.get(pk=visit_id)
    if visit.closed_at:
        return
    if visit.tickets.exclude(status__in=EXCLUDED).exists():
        raise Conflict("This table still has billable or pending orders.")
    visit.closed_at = timezone.now()
    visit.save(update_fields=["closed_at"])
    table.version += 1
    table.save(update_fields=["version"])
    audit("empty_visit_closed", visit.id, user=user)


@transaction.atomic
def make_device(user, name):
    code = secrets.token_hex(5).upper()
    device = KitchenDevice.objects.create(name=name, pairing_hash=digest(code), pairing_expires_at=timezone.now() + timedelta(minutes=10))
    audit("device_created", device.id, user=user)
    return device, code


@transaction.atomic
def pair_device(code):
    device = KitchenDevice.objects.select_for_update().filter(pairing_hash=digest(code.replace(" ", "").upper()), revoked_at=None, paired_at=None).first()
    if not device or device.pairing_expires_at <= timezone.now():
        raise ValidationError("This pairing code is invalid or expired. Ask the owner for a new one.")
    token = secrets.token_urlsafe(32)
    device.token_hash = digest(token)
    device.pairing_hash = None
    device.paired_at = timezone.now()
    device.save()
    audit("device_paired", device.id, device=device)
    return device, token
