from abc import ABC, abstractmethod
from typing import Any


class IntegrationService(ABC):
    """Contract for future M1 / Workroom / REST / webhook / CSV / DB sync."""

    system_name: str

    @abstractmethod
    def fetch_pending_grns(self) -> list[dict[str, Any]]:
        raise NotImplementedError

    @abstractmethod
    def import_grn(self, payload: dict[str, Any]) -> Any:
        raise NotImplementedError

    @abstractmethod
    def validate_payload(self, payload: dict[str, Any]) -> None:
        raise NotImplementedError
