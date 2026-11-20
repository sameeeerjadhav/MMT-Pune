from decimal import Decimal

from django.db import transaction
from django.utils.dateparse import parse_datetime
from django.utils import timezone

from barcodes.services import create_barcode, label_payload
from config.exceptions import ApiError
from grn.models import GRN, GRNLine
from integrations.models import IntegrationLog
from inventory.models import Category, InventoryBatch, InventoryTransaction, InventoryUnit, Item, Vendor


def _parse_dt(value):
    if hasattr(value, 'isoformat'):
        return value
    parsed = parse_datetime(str(value))
    if parsed:
        return parsed
    return timezone.now()


@transaction.atomic
def import_grn_payload(payload: dict, *, source='MOCK', system='MOCK'):
    grn_number = payload.get('grn_number')
    if not grn_number:
        raise ApiError('VALIDATION_ERROR', 'grn_number is required')

    external_system = payload.get('external_system', system)
    external_ref = payload.get('external_ref') or None
    lines = payload.get('lines') or []
    if not lines:
        raise ApiError('VALIDATION_ERROR', 'GRN must include at least one line')

    if external_ref:
        existing = GRN.objects.filter(
            external_system=external_system, external_ref=external_ref
        ).first()
        if existing:
            IntegrationLog.objects.create(
                source=source,
                system=external_system,
                payload=payload,
                status='DUPLICATE',
                message=f'Duplicate external ref {external_ref}',
                grn=existing,
            )
            raise ApiError(
                'DUPLICATE_GRN',
                'Duplicate external GRN record',
                status_code=409,
                details={'grn_id': existing.id, 'grn_number': existing.grn_number},
            )

    if GRN.objects.filter(grn_number=grn_number).exists():
        IntegrationLog.objects.create(
            source=source,
            system=external_system,
            payload=payload,
            status='DUPLICATE',
            message=f'Duplicate GRN number {grn_number}',
        )
        raise ApiError('DUPLICATE_GRN', f'GRN number {grn_number} already exists', status_code=409)

    vendor = None
    vendor_code = payload.get('vendor_code')
    vendor_name = payload.get('vendor_name')
    if vendor_code:
        vendor, _ = Vendor.objects.get_or_create(
            code=vendor_code, defaults={'name': vendor_name or vendor_code}
        )

    received_date = _parse_dt(payload.get('received_date') or timezone.now())

    grn = GRN.objects.create(
        grn_number=grn_number,
        external_system=external_system,
        external_ref=external_ref,
        vendor=vendor,
        received_date=received_date,
        status='RECEIVED',
        notes=payload.get('notes') or '',
    )

    for line in lines:
        item_code = line['item_code']
        classification = line['classification']
        category_code = line.get('category_code') or 'GEN'
        category, _ = Category.objects.get_or_create(
            code=category_code, defaults={'name': category_code}
        )
        item, _ = Item.objects.get_or_create(
            item_code=item_code,
            defaults={
                'name': line.get('item_name') or item_code,
                'description': line.get('description') or '',
                'category': category,
                'inventory_type': classification,
                'uom': line.get('uom') or 'EA',
            },
        )

        qty = Decimal(str(line['received_qty']))
        testing_status = line.get('testing_status') or 'PENDING'
        grn_line = GRNLine.objects.create(
            grn=grn,
            item=item,
            received_qty=qty,
            uom=line.get('uom') or item.uom,
            testing_status=testing_status,
            classification=classification,
            description=line.get('description') or '',
        )

        if classification == 'BULK':
            batch = InventoryBatch.objects.create(
                batch_code=f'TMP-{grn_line.id}',
                item=item,
                grn_line=grn_line,
                received_qty=qty,
                available_qty=qty,
                testing_status=testing_status,
                received_at=received_date,
            )
            batch.batch_code = line.get('batch_number') or f'BATCH-{batch.id:04d}'
            barcode = create_barcode(
                'BATCH',
                batch.id,
                label_payload(
                    item_name=item.name,
                    item_code=item.item_code,
                    grn_number=grn.grn_number,
                    batch_or_unit=batch.batch_code,
                    quantity=qty,
                ),
            )
            batch.barcode = barcode
            batch.save()
        else:
            count = int(qty)
            for _ in range(count):
                unit = InventoryUnit.objects.create(
                    unit_code=f'TMP-{grn_line.id}',
                    item=item,
                    grn_line=grn_line,
                    status='FAILED' if testing_status == 'FAILED' else 'AVAILABLE',
                    testing_status=testing_status,
                    received_at=received_date,
                )
                unit.unit_code = f'{item.item_code}-{unit.id:04d}'
                barcode = create_barcode(
                    'UNIT',
                    unit.id,
                    label_payload(
                        item_name=item.name,
                        item_code=item.item_code,
                        grn_number=grn.grn_number,
                        batch_or_unit=unit.unit_code,
                        quantity=1,
                    ),
                )
                unit.barcode = barcode
                unit.save()

        InventoryTransaction.objects.create(
            type='RECEIVE',
            quantity=qty,
            notes=f'Received via GRN {grn.grn_number}',
            metadata={'grn_id': grn.id, 'grn_line_id': grn_line.id},
        )

    IntegrationLog.objects.create(
        source=source,
        system=external_system,
        payload=payload,
        status='SUCCESS',
        message='GRN imported',
        grn=grn,
    )
    return grn


class MockIntegrationService:
    system_name = 'MOCK'

    def import_grn(self, payload: dict):
        return import_grn_payload(payload, source='MOCK', system=payload.get('external_system', 'MOCK'))
