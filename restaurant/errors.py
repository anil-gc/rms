from rest_framework.exceptions import APIException
from rest_framework.views import exception_handler as default_handler

class Conflict(APIException):
    status_code = 409
    default_detail = "This changed on another device. Refresh and try again."

def exception_handler(exc, context):
    response = default_handler(exc, context)
    if response is not None and isinstance(response.data, dict) and "detail" not in response.data:
        messages = []
        for key, value in response.data.items():
            messages.append(f"{key.replace('_', ' ').capitalize()}: {' '.join(map(str, value)) if isinstance(value, list) else value}")
        response.data = {"detail": " ".join(messages), "errors": response.data}
    return response
