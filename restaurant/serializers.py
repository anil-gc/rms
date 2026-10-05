from decimal import Decimal
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers
from .models import Category, DiningTable, MenuItem, RestaurantSettings, User


class CategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = Category
        fields = ["id", "name"]


class TableSerializer(serializers.ModelSerializer):
    class Meta:
        model = DiningTable
        fields = ["id", "name", "seats", "active", "version"]
        read_only_fields = ["version"]


class MenuSerializer(serializers.ModelSerializer):
    class Meta:
        model = MenuItem
        fields = ["id", "category", "name", "price", "available"]


class SettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = RestaurantSettings
        fields = ["name", "address", "phone", "receipt_footer"]


class UserSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, required=False, trim_whitespace=False)
    role = serializers.ChoiceField(choices=User.Role.choices)
    class Meta:
        model = User
        fields = ["id", "username", "first_name", "role", "is_active", "password"]

    def validate(self, attrs):
        if not self.instance and not attrs.get("password"):
            raise serializers.ValidationError({"password": "A password is required."})
        if "password" in attrs:
            try:
                candidate = self.instance or User(username=attrs.get("username", ""), first_name=attrs.get("first_name", ""))
                validate_password(attrs["password"], candidate)
            except DjangoValidationError as exc:
                raise serializers.ValidationError({"password": exc.messages})
        return attrs

    def create(self, validated_data):
        return User.objects.create_user(**validated_data)

    def update(self, instance, validated_data):
        password = validated_data.pop("password", None)
        for key, value in validated_data.items():
            setattr(instance, key, value)
        if password:
            instance.set_password(password)
        instance.save()
        return instance


class OrderItemInput(serializers.Serializer):
    menu_item = serializers.IntegerField(min_value=1)
    quantity = serializers.IntegerField(min_value=1, max_value=99)
    note = serializers.CharField(max_length=250, required=False, allow_blank=True, default="")
    expected_price = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=Decimal("0.01"))


class OrderInput(serializers.Serializer):
    request_id = serializers.UUIDField()
    table = serializers.IntegerField(min_value=1)
    table_version = serializers.IntegerField(min_value=0)
    items = OrderItemInput(many=True, allow_empty=False, max_length=100)


class PaymentInput(serializers.Serializer):
    request_id = serializers.UUIDField()
    method = serializers.ChoiceField(choices=["cash", "qr"])
    expected_total = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0.01"))
    qr_verified = serializers.BooleanField(default=False)


class ReasonInput(serializers.Serializer):
    reason = serializers.CharField(max_length=250, allow_blank=False)


class LoginInput(serializers.Serializer):
    username = serializers.CharField(max_length=150)
    password = serializers.CharField(max_length=256, trim_whitespace=False)


class PairInput(serializers.Serializer):
    code = serializers.CharField(min_length=8, max_length=20)


class DeviceInput(serializers.Serializer):
    name = serializers.CharField(max_length=80)
