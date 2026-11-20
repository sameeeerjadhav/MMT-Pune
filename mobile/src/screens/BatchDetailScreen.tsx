import React, { useEffect, useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { inventoryApi, barcodeApi } from '../api/endpoints';
import { getErrorMessage } from '../api/client';
import { Badge, Button, Card, ErrorState, LoadingState, Muted, Screen, Subtitle, Title } from '../components/ui';

export default function BatchDetailScreen({ route, navigation }: any) {
  const { id } = route.params;
  const [batch, setBatch] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const [b, h] = await Promise.all([inventoryApi.batch(id), inventoryApi.history('batch', id)]);
      setBatch(b.data);
      setHistory(h.data);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [id]);

  if (loading) return <LoadingState />;
  if (error || !batch) return <ErrorState message={error || 'Not found'} onRetry={load} />;

  const alloc = (batch.allocations || []).find((a: any) => a.is_active && a.allocation_type === 'ACTUAL');

  return (
    <Screen>
      <ScrollView>
        <Title>{batch.batch_code}</Title>
        <Badge label={batch.testing_status} tone={batch.testing_status === 'PASSED' ? 'success' : 'warning'} />
        <Card>
          <Subtitle>{batch.item?.name}</Subtitle>
          <Text>Item: {batch.item?.item_code}</Text>
          <Text>GRN: {batch.grn_number}</Text>
          <Text>Received: {String(batch.received_at).slice(0, 10)}</Text>
          <Text>Available: {batch.available_qty}</Text>
          <Text>Withdrawn: {batch.withdrawn_qty}</Text>
          <Text>Barcode: {batch.barcode_value}</Text>
          <Muted>
            Location: {alloc ? `${alloc.warehouse}/${alloc.rack}/${alloc.shelf}/${alloc.position_code}` : 'Unassigned'}
          </Muted>
        </Card>
        <Card>
          <Subtitle>Label preview</Subtitle>
          <Text>Airport Equipment Manufacturing</Text>
          <Text>{batch.item?.name}</Text>
          <Text>{batch.item?.item_code}</Text>
          <Text>{batch.grn_number}</Text>
          <Text>{batch.batch_code}</Text>
          <Text>{batch.barcode_value}</Text>
          <Text>Qty: {batch.available_qty}</Text>
          <Button
            label="Log print"
            variant="secondary"
            onPress={async () => {
              if (batch.barcode_value) await barcodeApi.printLog(batch.barcode_value, { notes: 'demo preview' });
            }}
          />
        </Card>
        <Card>
          <Subtitle>History</Subtitle>
          {history.map((tx) => (
            <Text key={tx.id} style={{ marginBottom: 6 }}>
              {tx.type} {tx.quantity || ''} — {String(tx.created_at).slice(0, 19)}
            </Text>
          ))}
        </Card>
        <Button label="Withdraw this batch" onPress={() => navigation.navigate('Withdrawal', { batchId: batch.id })} />
      </ScrollView>
    </Screen>
  );
}
