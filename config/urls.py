from django.http import FileResponse, JsonResponse
from django.conf import settings
from django.urls import include, path, re_path
from django.db import connection


def app(request):
    index = settings.BASE_DIR / "frontend" / "dist" / "index.html"
    if not index.exists():
        return JsonResponse({"detail": "Build the frontend first: npm run build in frontend."}, status=503)
    response = FileResponse(index.open("rb"), content_type="text/html")
    response["Cache-Control"] = "no-store"
    return response


def health(request):
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
        return JsonResponse({"status": "ok"})
    except Exception:
        return JsonResponse({"status": "unavailable"}, status=503)


urlpatterns = [path("api/v1/", include("restaurant.urls")), path("health/", health), re_path(r"^(?!api/|static/).*$", app)]
