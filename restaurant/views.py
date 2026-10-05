from datetime import datetime, time, timedelta
from decimal import Decimal

from django.contrib.auth import authenticate, login, logout, update_session_auth_hash
from django.db import transaction
from django.db.models import Q, Sum, Count
from django.middleware.csrf import get_token
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.authentication import SessionAuthentication
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import PermissionDenied, ValidationError, NotAuthenticated
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .errors import Conflict
from .models import AuditEvent, Category, DiningTable, KitchenDevice, MenuItem, Payment, RestaurantSettings, Ticket, User, Visit
from .serializers import CategorySerializer, DeviceInput, LoginInput, MenuSerializer, OrderInput, PairInput, PaymentInput, ReasonInput, SettingsSerializer, TableSerializer, UserSerializer
from .services import EXCLUDED, audit, close_empty_visit, digest, make_device, pair_device, pay_visit, submit_order, throttle, ticket_data, tickets_query, transition


def validate(serializer_class, data):
    serializer = serializer_class(data=data)
    serializer.is_valid(raise_exception=True)
    return serializer.validated_data


def require_role(request, *roles):
    if not request.user.is_authenticated:
        raise NotAuthenticated("Please sign in.")
    if not request.user.is_active or request.user.access_role not in roles:
        raise PermissionDenied("You do not have access to this screen.")
    return request.user


def kitchen_identity(request):
    device_id = request.session.get("kitchen_id")
    token = request.session.get("kitchen_token", "")
    if device_id and token:
        return KitchenDevice.objects.filter(pk=device_id, token_hash=digest(token), revoked_at=None).first()
    return None


def require_kitchen(request):
    device = kitchen_identity(request)
    if device:
        return None, device
    return require_role(request, "owner"), None


@api_view(["GET"])
@permission_classes([AllowAny])
def session_view(request):
    restaurant, _ = RestaurantSettings.objects.get_or_create(pk=1)
    user = None
    if request.user.is_authenticated:
        user = {"id": request.user.id, "username": request.user.username, "name": request.user.first_name or request.user.username, "role": request.user.access_role}
    device = kitchen_identity(request)
    return Response({"user": user, "device": {"id": device.id, "name": device.name} if device else None, "restaurant_name": restaurant.name, "csrf_token": get_token(request)})


@api_view(["POST"])
@permission_classes([AllowAny])
def login_view(request):
    SessionAuthentication().enforce_csrf(request)
    throttle(request, "login")
    data = validate(LoginInput, request.data)
    user = authenticate(request=request, **data)
    if not user:
        raise ValidationError("Incorrect username or password.")
    request.session.flush()
    login(request, user)
    audit("signed_in", user.id, user=user)
    return Response({"detail": "Signed in."})


@api_view(["POST"])
@permission_classes([AllowAny])
def logout_view(request):
    SessionAuthentication().enforce_csrf(request)
    logout(request)
    return Response({"detail": "Signed out."})


@api_view(["GET"])
def state_view(request):
    require_role(request, "owner", "billing", "staff")
    visits = Visit.objects.filter(closed_at=None).prefetch_related("tickets__items", "tickets__created_by", "tickets__visit__table")
    by_table = {v.table_id: v for v in visits}
    tables = []
    for table in DiningTable.objects.filter(Q(active=True) | Q(id__in=by_table.keys())):
        visit = by_table.get(table.id)
        data = TableSerializer(table).data
        data["visit"] = visit.id if visit else None
        data["opened_at"] = visit.opened_at.isoformat() if visit else None
        active = [t for t in visit.tickets.all() if t.status not in EXCLUDED] if visit else []
        total = sum((t.total for t in active), Decimal("0.00"))
        data.update(total=str(total), can_pay=bool(active) and all(t.status == "served" for t in active), can_close_empty=bool(visit) and not active)
        tables.append(data)
    tickets = tickets_query().filter(visit__closed_at=None)
    restaurant, _ = RestaurantSettings.objects.get_or_create(pk=1)
    return Response({"tables": tables, "tickets": [ticket_data(t) for t in tickets], "menu": MenuSerializer(MenuItem.objects.all(), many=True).data,
                     "categories": CategorySerializer(Category.objects.all(), many=True).data, "restaurant": SettingsSerializer(restaurant).data})


@api_view(["POST"])
def order_create(request):
    user = require_role(request, "owner", "billing", "staff")
    ticket, created = submit_order(user, validate(OrderInput, request.data))
    return Response(ticket_data(ticket), status=201 if created else 200)


@api_view(["GET"])
def order_request(request, request_id):
    user = require_role(request, "owner", "billing", "staff")
    ticket = get_object_or_404(tickets_query(), created_by=user, request_id=request_id)
    return Response(ticket_data(ticket))


@api_view(["POST"])
def order_action(request, pk, action):
    user = require_role(request, "owner", "billing", "staff")
    reason = validate(ReasonInput, request.data)["reason"] if action in {"reject", "void"} else ""
    ticket = transition(pk, action, user=user, reason=reason)
    return Response(ticket_data(ticket))


@api_view(["POST"])
def payment_create(request, pk):
    user = require_role(request, "owner", "billing")
    payment, created = pay_visit(user, pk, validate(PaymentInput, request.data))
    return Response(payment.receipt, status=201 if created else 200)


@api_view(["POST"])
def visit_close(request, pk):
    user = require_role(request, "owner", "billing")
    close_empty_visit(user, pk)
    return Response({"detail": "Table is available."})


@api_view(["GET"])
def payment_request(request, request_id):
    user = require_role(request, "owner", "billing")
    payment = get_object_or_404(Payment, request_id=request_id, cashier=user)
    return Response(payment.receipt)


@api_view(["GET"])
def receipt_list(request):
    require_role(request, "owner", "billing")
    payments = Payment.objects.order_by("-created_at")[:100]
    return Response([p.receipt for p in payments])


@api_view(["GET"])
def receipt_detail(request, pk):
    require_role(request, "owner", "billing")
    return Response(get_object_or_404(Payment, pk=pk).receipt)


@api_view(["GET"])
def sales_view(request):
    require_role(request, "owner")
    day = timezone.localdate()
    if request.query_params.get("date"):
        try:
            day = datetime.strptime(request.query_params["date"], "%Y-%m-%d").date()
        except ValueError:
            raise ValidationError("Use a date in YYYY-MM-DD format.")
    start = timezone.make_aware(datetime.combine(day, time.min))
    payments = Payment.objects.filter(created_at__gte=start, created_at__lt=start + timedelta(days=1))
    amounts = {row["method"]: format(row["amount"], ".2f") for row in payments.values("method").annotate(amount=Sum("amount"))}
    return Response({"date": str(day), "count": payments.count(), "total": format(payments.aggregate(amount=Sum("amount"))["amount"] or Decimal("0.00"), ".2f"),
                     "cash": amounts.get("cash", "0.00"), "qr": amounts.get("qr", "0.00")})


@api_view(["GET"])
@permission_classes([AllowAny])
def kitchen_queue(request):
    require_kitchen(request)
    tickets = tickets_query().filter(Q(visit__closed_at=None, status__in=["approved", "preparing", "ready"]) | Q(status="voided", updated_at__gte=timezone.now() - timedelta(hours=24)))
    return Response([ticket_data(t, kitchen=True) for t in tickets])


@api_view(["POST"])
@permission_classes([AllowAny])
def kitchen_action(request, pk, action):
    SessionAuthentication().enforce_csrf(request)
    user, device = require_kitchen(request)
    if action not in {"prepare", "ready"}:
        raise PermissionDenied("Kitchen devices can only update preparation status.")
    ticket = transition(pk, action, user=user, device=device)
    return Response(ticket_data(ticket, kitchen=True))


@api_view(["POST"])
@permission_classes([AllowAny])
def device_pair(request):
    SessionAuthentication().enforce_csrf(request)
    throttle(request, "pair", limit=10)
    data = validate(PairInput, request.data)
    device, token = pair_device(data["code"])
    request.session.flush()
    request.session["kitchen_id"] = device.id
    request.session["kitchen_token"] = token
    request.session.set_expiry(60 * 60 * 24 * 30)
    return Response({"detail": "Kitchen screen connected."})


def device_data(device):
    return {"id": device.id, "name": device.name, "paired_at": device.paired_at, "revoked_at": device.revoked_at, "pairing_expires_at": device.pairing_expires_at}


@api_view(["POST"])
def device_create(request):
    user = require_role(request, "owner")
    device, code = make_device(user, validate(DeviceInput, request.data)["name"])
    return Response({**device_data(device), "code": code}, status=201)


@api_view(["POST"])
def device_revoke(request, pk):
    user = require_role(request, "owner")
    with transaction.atomic():
        device = get_object_or_404(KitchenDevice.objects.select_for_update(), pk=pk)
        device.revoked_at = timezone.now()
        device.token_hash = None
        device.pairing_hash = None
        device.save()
        audit("device_revoked", device.id, user=user)
    return Response({"detail": "Device access removed."})


@api_view(["GET"])
def management_view(request):
    require_role(request, "owner")
    restaurant, _ = RestaurantSettings.objects.get_or_create(pk=1)
    return Response({
        "settings": SettingsSerializer(restaurant).data,
        "users": UserSerializer(User.objects.order_by("id"), many=True).data,
        "categories": CategorySerializer(Category.objects.all(), many=True).data,
        "menu": MenuSerializer(MenuItem.objects.all(), many=True).data,
        "tables": TableSerializer(DiningTable.objects.all(), many=True).data,
        "devices": [device_data(d) for d in KitchenDevice.objects.order_by("-id")],
        "audit": [{"id": a.id, "action": a.action, "target": a.target, "actor": (a.user.first_name or a.user.username) if a.user else (a.device.name if a.device else "System"), "detail": a.detail, "created_at": a.created_at} for a in AuditEvent.objects.select_related("user", "device")[:100]],
    })


@api_view(["POST", "PATCH"])
def management_edit(request, resource, pk=None):
    user = require_role(request, "owner")
    models = {"menu": (MenuItem, MenuSerializer), "categories": (Category, CategorySerializer), "tables": (DiningTable, TableSerializer), "users": (User, UserSerializer), "settings": (RestaurantSettings, SettingsSerializer)}
    if resource not in models:
        raise ValidationError("Unknown setting.")
    model, serializer_class = models[resource]
    if resource == "settings":
        pk = 1
    if request.method == "PATCH" and pk is None:
        raise ValidationError("Choose the item to edit.")
    if request.method == "POST" and pk is not None:
        raise ValidationError("Use save changes to update an existing item.")
    with transaction.atomic():
        # Serialize account changes to prevent two owners simultaneously removing the last owner.
        if resource == "users":
            list(User.objects.select_for_update().order_by("id"))
        instance = get_object_or_404(model.objects.select_for_update(), pk=pk) if pk else None
        serializer = serializer_class(instance, data=request.data, partial=request.method == "PATCH")
        serializer.is_valid(raise_exception=True)
        if resource == "users" and instance:
            new_role = serializer.validated_data.get("role", instance.role)
            active = serializer.validated_data.get("is_active", instance.is_active)
            if instance.pk == user.pk and (not active or new_role != "owner"):
                raise ValidationError("You cannot remove your own owner access.")
            if instance.is_superuser and new_role != "owner":
                raise ValidationError("The initial superuser must remain an owner.")
            if instance.access_role == "owner" and (not active or new_role != "owner"):
                if not User.objects.filter(is_active=True).filter(Q(role="owner") | Q(is_superuser=True)).exclude(pk=instance.pk).exists():
                    raise ValidationError("Keep at least one active owner.")
        if resource == "tables" and instance and Visit.objects.filter(table=instance, closed_at=None).exists():
            if not serializer.validated_data.get("active", instance.active) or serializer.validated_data.get("name", instance.name) != instance.name:
                raise Conflict("Close this table's bill before renaming or disabling it.")
        saved = serializer.save()
        if resource == "users" and saved.pk == user.pk and "password" in serializer.validated_data:
            update_session_auth_hash(request, saved)
        audit(f"{resource}_{'updated' if instance else 'created'}", saved.pk, user=user)
    return Response(serializer.data, status=200 if instance else 201)
