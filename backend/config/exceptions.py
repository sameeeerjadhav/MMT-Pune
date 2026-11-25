import logging

from django.conf import settings
from django.core.exceptions import ObjectDoesNotExist
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import exception_handler, set_rollback

logger = logging.getLogger(__name__)

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

    if isinstance(exc, ObjectDoesNotExist):
        set_rollback()
        return Response(
            {'code': 'NOT_FOUND', 'message': 'Not found', 'details': None},
            status=status.HTTP_404_NOT_FOUND,
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

    set_rollback()
    logger.error('Unhandled API exception', exc_info=exc)
    return Response(
        {
            'code': 'INTERNAL_ERROR',
            'message': 'Internal server error',
            'details': str(exc) if settings.DEBUG else None,
        },
        status=status.HTTP_500_INTERNAL_SERVER_ERROR,
    )
