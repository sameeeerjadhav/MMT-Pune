from django.conf import settings

from barcodes.models import Barcode


def build_barcode_value(entity_type: str, barcode_id: int) -> str:
    prefix = {'BATCH': 'B', 'UNIT': 'U', 'RACK': 'R'}.get(entity_type, 'X')
    return f'{prefix}{barcode_id:010d}'


def create_barcode(entity_type: str, entity_id: int, label_data: dict | None = None) -> Barcode:
    barcode = Barcode.objects.create(
        value=f'TMP-{entity_type}-{entity_id}',
        entity_type=entity_type,
        entity_id=entity_id,
        label_data=label_data or {},
    )
    barcode.value = build_barcode_value(entity_type, barcode.id)
    barcode.save(update_fields=['value'])
    return barcode


def label_payload(*, item_name, item_code, grn_number='', batch_or_unit='', quantity=None):
    data = {
        'company_name': settings.COMPANY_NAME,
        'item_name': item_name,
        'item_code': item_code,
        'grn_number': grn_number,
        'batch_or_unit': batch_or_unit,
    }
    if quantity is not None:
        data['quantity'] = str(quantity)
    return data
