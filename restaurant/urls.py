from django.urls import path
from . import views

urlpatterns = [
    path("auth/session/", views.session_view), path("auth/login/", views.login_view), path("auth/logout/", views.logout_view),
    path("state/", views.state_view),
    path("orders/", views.order_create), path("orders/requests/<uuid:request_id>/", views.order_request), path("orders/<int:pk>/<str:action>/", views.order_action),
    path("visits/<int:pk>/payment/", views.payment_create), path("visits/<int:pk>/close-empty/", views.visit_close),
    path("payments/requests/<uuid:request_id>/", views.payment_request), path("receipts/", views.receipt_list), path("receipts/<int:pk>/", views.receipt_detail),
    path("reports/daily/", views.sales_view),
    path("kitchen/pair/", views.device_pair), path("kitchen/queue/", views.kitchen_queue), path("kitchen/orders/<int:pk>/<str:action>/", views.kitchen_action),
    path("management/", views.management_view), path("management/devices/", views.device_create), path("management/devices/<int:pk>/revoke/", views.device_revoke),
    path("management/<str:resource>/", views.management_edit), path("management/<str:resource>/<int:pk>/", views.management_edit),
]
