from django.test import TestCase

from audit.models import AuditLog
from config.factories import WarehouseTestMixin


class AuditLogApiTests(WarehouseTestMixin, TestCase):
    def setUp(self):
        self.setUpWarehouse()
        AuditLog.objects.create(
            user=self.admin, action='LOGIN', entity_type='User', entity_id=self.admin.id,
            details={'ok': True}, ip_address='10.0.0.1',
        )
        AuditLog.objects.create(
            user=self.employee, action='ALLOCATE', entity_type='StockAllocation', entity_id=7,
            details={'note': 'bolts to R1'},
        )
        AuditLog.objects.create(action='SYSTEM', entity_type='System', details={})

    def get(self, query='', api=None):
        return (api or self.admin_api).get(f'/api/audit-logs/{query}')

    def test_admin_only(self):
        self.assertEqual(self.get(api=self.super_api).status_code, 403)
        self.assertEqual(self.get(api=self.emp_api).status_code, 403)
        self.assertEqual(self.get().status_code, 200)

    def test_shape_and_facets(self):
        res = self.get()
        self.assertEqual(res.data['count'], 3)
        newest = res.data['results'][0]
        self.assertIn('created_at', newest)
        self.assertEqual(set(res.data['facets']), {'actions', 'entity_types'})
        self.assertIn('ALLOCATE', res.data['facets']['actions'])
        by_action = {r['action']: r for r in res.data['results']}
        self.assertEqual(by_action['ALLOCATE']['user']['username'], 'f_emp')
        self.assertIsNone(by_action['SYSTEM']['user'])

    def test_filters(self):
        self.assertEqual(self.get('?action=ALLOCATE').data['count'], 1)
        self.assertEqual(self.get('?entity_type=User').data['count'], 1)
        self.assertEqual(self.get(f'?user_id={self.employee.id}').data['count'], 1)
        self.assertEqual(self.get('?q=f_emp').data['count'], 1)  # by username
        self.assertEqual(self.get('?q=alloc').data['count'], 1)  # partial, case-insensitive action
        self.assertEqual(self.get('?q=nothing-matches-this').data['count'], 0)

    def test_paging(self):
        for i in range(5):
            AuditLog.objects.create(action='BULK', entity_type='X', entity_id=i)
        page1 = self.get('?limit=3').data
        self.assertEqual(len(page1['results']), 3)
        self.assertEqual(page1['next_offset'], 3)
        self.assertIn('facets', page1)
        page2 = self.get('?limit=3&offset=3').data
        self.assertNotIn('facets', page2)
        last = self.get('?limit=3&offset=6').data
        self.assertIsNone(last['next_offset'])
        self.assertEqual(len(last['results']), 2)
        self.assertEqual(self.get('?limit=99999').data['limit'], 200)

    def test_bad_date_is_a_validation_error(self):
        self.assertEqual(self.get('?date_from=not-a-date').status_code, 400)
