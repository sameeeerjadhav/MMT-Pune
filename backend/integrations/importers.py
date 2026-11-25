from datetime import date, datetime, time
from decimal import Decimal, InvalidOperation

from django.db import IntegrityError, transaction
from django.utils.dateparse import parse_date, parse_datetime
from django.utils import timezone

from barcodes.services import create_barcode, label_payload
from config.exceptions import ApiError
from grn.models import GRN, GRNLine
from integrations.models import IntegrationLog
from inventory.models import Category, InventoryBatch, InventoryTransaction, InventoryUnit, Item, Vendor


TESTING_STATUSES = ('PENDING', 'PASSED', 'FAILED')


def _parse_dt(value):
    """Missing → now; unreadable or impossible dates are rejected so FIFO order is never guessed."""
    if not value:
        return timezone.now()
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, date):
        parsed = datetime.combine(value, time.min)
    else:
        text = str(value).strip()
        try:
            parsed = parse_datetime(text)
            if parsed is None:
                day = parse_date(text)
                parsed = datetime.combine(day, time.min) if day else None
        except ValueError:
            parsed = None
        if parsed is None:
            raise ApiError('VALIDATION_ERROR', f'Invalid received_date {value!r}')
    if timezone.is_naive(parsed):
        parsed = timezone.make_aware(parsed)
    return parsed


def _clean_line(line, index):
    if not isinstance(line, dict):
        raise ApiError('VALIDATION_ERROR', f'Line {index} must be an object')
    item_code = str(line.get('item_code') or '').strip()
    if not item_code:
        raise ApiError('VALIDATION_ERROR', f'Line {index}: item_code is required')
    classification = str(line.get('classification') or '').strip().upper()
    if classification not in ('BULK', 'UNIT'):
        raise ApiError(
            'VALIDATION_ERROR',
            f'Invalid classification {line.get("classification")!r} for item {item_code}',
        )
    try:
        qty = Decimal(str(line.get('received_qty')))
    except (InvalidOperation, ValueError):
        qty = None
    if qty is None or not qty.is_finite() or qty <= 0:
        raise ApiError('VALIDATION_ERROR', f'received_qty must be a positive number for {item_code}')
    testing_status = str(line.get('testing_status') or 'PENDING').strip().upper()
    if testing_status not in TESTING_STATUSES:
        raise ApiError(
            'VALIDATION_ERROR',
            f'Invalid testing_status {line.get("testing_status")!r} for item {item_code}',
            details={'allowed': list(TESTING_STATUSES)},
        )
    return item_code, classification, qty, testing_status


def _validate_payload(payload: dict, system):
    grn_number = payload.get('grn_number')
    if not grn_number:
        raise ApiError('VALIDATION_ERROR', 'grn_number is required')
    lines = payload.get('lines') or []
    if not isinstance(lines, list) or not lines:
        raise ApiError('VALIDATION_ERROR', 'GRN must include at least one line')
    cleaned = [_clean_line(line, i + 1) for i, line in enumerate(lines)]
    received_date = _parse_dt(payload.get('received_date'))
    return grn_number, payload.get('external_system', system), cleaned, received_date


def import_grn_payload(payload: dict, *, source='MOCK', system='MOCK'):
    grn_number, external_system, cleaned, received_date = _validate_payload(payload, system)
    external_ref = payload.get('external_ref') or None
    # Duplicate logs are written outside the import transaction so the 409 does not roll them back.
    _reject_duplicates(payload, source, external_system, external_ref, grn_number)
    return _create_grn(
        payload,
        source=source,
        external_system=external_system,
        external_ref=external_ref,
        grn_number=grn_number,
        cleaned=cleaned,
        received_date=received_date,
    )


def _reject_duplicates(payload, source, external_system, external_ref, grn_number):
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


@transaction.atomic
def _create_grn(
    payload, *, source, external_system, external_ref, grn_number, cleaned, received_date
):
    vendor = None
    vendor_code = payload.get('vendor_code')
    vendor_name = payload.get('vendor_name')
    if vendor_code:
        vendor, _ = Vendor.objects.get_or_create(
            code=vendor_code, defaults={'name': vendor_name or vendor_code}
        )

    try:
        with transaction.atomic():
            grn = GRN.objects.create(
                grn_number=grn_number,
                external_system=external_system,
                external_ref=external_ref,
                vendor=vendor,
                received_date=received_date,
                status='RECEIVED',
                notes=payload.get('notes') or '',
            )
    except IntegrityError:
        # Lost a race with a concurrent import of the same GRN.
        raise ApiError('DUPLICATE_GRN', f'GRN number {grn_number} already exists', status_code=409)

    for line, (item_code, classification, qty, testing_status) in zip(payload['lines'], cleaned):
        category_code = line.get('category_code') or 'GEN'
        category, _ = Category.objects.get_or_create(
            code=category_code, defaults={'name': category_code}
        )
        item, created = Item.objects.get_or_create(
            item_code=item_code,
            defaults={
                'name': line.get('item_name') or item_code,
                'description': line.get('description') or '',
                'category': category,
                'inventory_type': classification,
                'uom': line.get('uom') or 'EA',
            },
        )
        if not created and item.inventory_type != classification:
            raise ApiError(
                'VALIDATION_ERROR',
                f'Item {item_code} is {item.inventory_type}; GRN line classification is {classification}',
                details={
                    'item_code': item_code,
                    'item_inventory_type': item.inventory_type,
                    'line_classification': classification,
                },
            )

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
            batch_number = line.get('batch_number') or None
            if batch_number and InventoryBatch.objects.filter(batch_code=batch_number).exists():
                raise ApiError(
                    'DUPLICATE_GRN',
                    f'Batch number {batch_number} already exists',
                    status_code=409,
                    details={'batch_number': batch_number},
                )
            batch = InventoryBatch.objects.create(
                batch_code=f'TMP-{grn_line.id}',
                item=item,
                grn_line=grn_line,
                received_qty=qty,
                available_qty=qty,
                testing_status=testing_status,
                received_at=received_date,
            )
            batch.batch_code = batch_number or f'BATCH-{batch.id:04d}'
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
            try:
                batch.save()
            except IntegrityError:
                raise ApiError(
                    'DUPLICATE_GRN',
                    f'Batch number {batch.batch_code} already exists',
                    status_code=409,
                    details={'batch_number': batch.batch_code},
                )
            InventoryTransaction.objects.create(
                type='RECEIVE',
                batch=batch,
                quantity=qty,
                notes=f'Received via GRN {grn.grn_number}',
                metadata={'grn_id': grn.id, 'grn_line_id': grn_line.id},
            )
        else:
            if qty != qty.to_integral_value():
                raise ApiError(
                    'VALIDATION_ERROR',
                    f'UNIT line for {item_code} requires a whole-number received_qty (got {qty})',
                )
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
                    unit=unit,
                    quantity=Decimal('1'),
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
