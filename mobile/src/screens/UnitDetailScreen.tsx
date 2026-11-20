import React, { useEffect, useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { inventoryApi } from '../api/endpoints';
import { getErrorMessage } from '../api/client';
import { Badge, Button, Card, ErrorState, LoadingState, Muted, Screen, Subtitle, Title } from '../components/ui';

export default function UnitDetailScreen({ route, navigation }: any) {
  const { id } = route.params;
  const [unit, setUnit] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [u, h] = await Promise.all([inventoryApi.unit(id), inventoryApi.history('unit', id)]);
        setUnit(u.data);
        setHistory(h.data);
      } catch (e) {
        setError(getErrorMessage(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  if (loading) return <LoadingState />;
  if (error || !unit) return <ErrorState message={error || 'Not found'} />;

  const alloc = (unit.allocations || []).find((a: any) => a.is_active && a.allocation_type === 'ACTUAL');

  return (
    <Screen>
      <ScrollView>
        <Title>{unit.unit_code}</Title>
        <Badge label={unit.status} tone={unit.status === 'AVAILABLE' ? 'success' : 'danger'} />
        <Card>
          <Subtitle>{unit.item?.name}</Subtitle>
          <Text>Barcode: {unit.barcode_value}</Text>
          <Text>GRN: {unit.grn_number}</Text>
          <Text>Testing: {unit.testing_status}</Text>
          <Muted>
            Location: {alloc ? `${alloc.warehouse}/${alloc.rack}/${alloc.shelf}/${alloc.position_code}` : 'Unassigned'}
          </Muted>
        </Card>
        <Card>
          <Subtitle>History</Subtitle>
          {history.map((tx) => (
            <Text key={tx.id} style={{ marginBottom: 6 }}>
              {tx.type} — {String(tx.created_at).slice(0, 19)}
            </Text>
          ))}
        </Card>
        {unit.status === 'AVAILABLE' ? (
          <Button label="Withdraw this unit" onPress={() => navigation.navigate('Withdrawal', { unitId: unit.id })} />
        ) : null}
      </ScrollView>
    </Screen>
  );
}
