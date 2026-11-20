from typing import Any

from config.exceptions import ApiError
from integrations.base import IntegrationService


class M1IntegrationService(IntegrationService):
    """Stub for future M1 REST/webhook/DB integration. Not live — no credentials."""

    system_name = 'M1'

    def fetch_pending_grns(self) -> list[dict[str, Any]]:
        raise ApiError(
            'NOT_CONFIGURED',
            'M1 integration is not configured. Use mock GRN import for demo.',
            status_code=501,
        )

    def import_grn(self, payload: dict[str, Any]):
        raise ApiError(
            'NOT_CONFIGURED',
            'M1 integration is not configured. Use mock GRN import for demo.',
            status_code=501,
        )

    def validate_payload(self, payload: dict[str, Any]) -> None:
        if not payload.get('grn_number'):
            raise ApiError('VALIDATION_ERROR', 'grn_number is required')
