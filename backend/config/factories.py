"""Small helpers shared by the backend test-suites."""

from decimal import Decimal
from itertools import count

from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Role
from barcodes.models import Barcode
from barcodes.services import create_barcode
from grn.models import GRN, GRNLine
from inventory.models import (
    Category,
    InventoryBatch,
    InventoryUnit,
    Item,
    StockAllocation,
    Vendor,
)
from warehouses.models import Rack, RackPosition, Shelf, Warehouse

User = get_user_model()
_seq = count(1)


class WarehouseTestMixin:
    """Roles, one user + API client per role, and quick builders for stock and locations."""

    def setUpWarehouse(self):
        roles = {}
        for code, name in (
            ('ADMIN', 'Administrator'),
            ('SUPERVISOR', 'Supervisor'),
            ('WAREHOUSE_EMPLOYEE', 'Warehouse Employee'),
        ):
            roles[code], _ = Role.objects.get_or_create(code=code, defaults={'name': name})
        self.admin = User.objects.create_user(username='f_admin', role=roles['ADMIN'])
        self.supervisor = User.objects.create_user(
            username='f_super', role=roles['SUPERVISOR']
        )
        self.employee = User.objects.create_user(
            username='f_emp', role=roles['WAREHOUSE_EMPLOYEE']
        )
        self.employee2 = User.objects.create_user(
            username='f_emp2', role=roles['WAREHOUSE_EMPLOYEE']
        )
        self.admin_api = self.api_for(self.admin)
        self.super_api = self.api_for(self.supervisor)
        self.emp_api = self.api_for(self.employee)
        self.emp2_api = self.api_for(self.employee2)

        self.category = Category.objects.create(code='FC', name='Fixtures')
        self.vendor = Vendor.objects.create(code='FV', name='Fixture Vendor')
        self.warehouse = Warehouse.objects.create(code='WH1', name='Main')

    @staticmethod
    def api_for(user):
        client = APIClient()
        client.force_authenticate(user=user)
        return client

    def make_item(self, code=None, inventory_type='BULK', **extra):
        n = next(_seq)
        return Item.objects.create(
            item_code=code or f'ITEM-{n}',
            name=extra.pop('name', f'Item {n}'),
            category=self.category,
            inventory_type=inventory_type,
            **extra,
        )

    def make_grn(self, number=None):
        return GRN.objects.create(
            grn_number=number or f'GRN-{next(_seq)}',
            vendor=self.vendor,
            received_date=timezone.now(),
            external_system='MANUAL',
        )

    def make_line(self, grn, item, qty=10, testing='PASSED'):
        return GRNLine.objects.create(
            grn=grn,
            item=item,
            received_qty=qty,
            uom=item.uom,
            testing_status=testing,
            classification=item.inventory_type,
        )

    def make_batch(self, item, qty=10, *, grn=None, testing='PASSED', expiry=None, code=None, barcode=True):
        grn = grn or self.make_grn()
        line = self.make_line(grn, item, qty, testing)
        batch = InventoryBatch.objects.create(
            batch_code=code or f'B-{next(_seq)}',
            item=item,
            grn_line=line,
            received_qty=Decimal(qty),
            available_qty=Decimal(qty),
            testing_status=testing,
            received_at=timezone.now(),
            expiry_date=expiry,
        )
        if barcode:
            batch.barcode = create_barcode(Barcode.EntityType.BATCH, batch.id)
            batch.save(update_fields=['barcode'])
        return batch

    def make_unit(self, item, *, grn=None, testing='PASSED', code=None, barcode=True):
        grn = grn or self.make_grn()
        line = self.make_line(grn, item, 1, testing)
        unit = InventoryUnit.objects.create(
            unit_code=code or f'U-{next(_seq)}',
            item=item,
            grn_line=line,
            testing_status=testing,
            received_at=timezone.now(),
        )
        if barcode:
            unit.barcode = create_barcode(Barcode.EntityType.UNIT, unit.id)
            unit.save(update_fields=['barcode'])
        return unit

    def make_rack(self, code='R1', positions=2):
        rack = Rack.objects.create(warehouse=self.warehouse, code=code, name=f'Rack {code}')
        shelf = Shelf.objects.create(rack=rack, code='S1')
        slots = [RackPosition.objects.create(shelf=shelf, code=f'P{i + 1}') for i in range(positions)]
        return rack, slots

    @staticmethod
    def allocate(position, *, batch=None, unit=None, qty=None):
        return StockAllocation.objects.create(
            allocation_type='ACTUAL',
            batch=batch,
            unit=unit,
            position=position,
            quantity=Decimal(qty) if qty is not None else None,
            is_active=True,
        )
