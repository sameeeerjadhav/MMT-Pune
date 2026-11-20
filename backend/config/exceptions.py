from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import exception_handler


class ApiError(Exception):
    def __init__(self, code: str, message: str, status_code: int = 400, details=None):
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details
        super().__init__(message)


def custom_exception_handler(exc, context):
    if isinstance(exc, ApiError):
        return Response(
            {'code': exc.code, 'message': exc.message, 'details': exc.details},
            status=exc.status_code,
        )

    response = exception_handler(exc, context)
    if response is not None:
        detail = response.data
        if isinstance(detail, dict) and 'detail' in detail and len(detail) == 1:
            message = str(detail['detail'])
        else:
            message = 'Request failed'
        return Response(
            {
                'code': 'ERROR',
                'message': message,
                'details': detail,
            },
            status=response.status_code,
        )

    return Response(
        {'code': 'INTERNAL_ERROR', 'message': 'Internal server error', 'details': str(exc)},
        status=status.HTTP_500_INTERNAL_SERVER_ERROR,
    )
