import React, { useEffect, useState } from 'react';
import { Image, ScrollView, Text } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { inventoryApi, barcodeApi } from '../api/endpoints';
import { getErrorMessage } from '../api/client';
import { Badge, Button, Card, ErrorState, LoadingState, Muted, Screen, Subtitle, Title } from '../components/ui';

export default function BatchDetailScreen({ route, navigation }: any) {
  const { id } = route.params;
  const [batch, setBatch] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [labelUri, setLabelUri] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [printMsg, setPrintMsg] = useState('');

  const load = async () => {
    try {
      const [b, h] = await Promise.all([inventoryApi.batch(id), inventoryApi.history('batch', id)]);
      setBatch(b.data);
      setHistory(h.data);
      if (b.data.barcode_value) {
        const token = await SecureStore.getItemAsync('accessToken');
        const url = barcodeApi.labelUrl(b.data.barcode_value);
        // Prefer base64 from detail API so Image does not need auth headers.
        try {
          const detail = await barcodeApi.get(b.data.barcode_value);
          if (detail.data.label_image_base64) {
            setLabelUri(`data:image/png;base64,${detail.data.label_image_base64}`);
          } else {
            setLabelUri(token ? `${url}?t=${Date.now()}` : url);
          }
        } catch {
          setLabelUri(url);
        }
      }
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
  const label = batch.barcode_label_data || {};

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
          <Subtitle>Label preview (Code 128)</Subtitle>
          <Text>{label.company_name || 'Airport Equipment Manufacturing'}</Text>
          <Text>{label.item_name || batch.item?.name}</Text>
          <Text>{label.item_code || batch.item?.item_code}</Text>
          <Text>GRN: {label.grn_number || batch.grn_number}</Text>
          <Text>{label.batch_or_unit || batch.batch_code}</Text>
          {label.quantity ? <Text>Qty: {label.quantity}</Text> : null}
          {labelUri ? (
            <Image
              source={{ uri: labelUri }}
              style={{ width: '100%', height: 160, resizeMode: 'contain', marginTop: 8, backgroundColor: '#fff' }}
            />
          ) : (
            <Muted>Label image unavailable</Muted>
          )}
          <Button
            label="Log print"
            variant="secondary"
            onPress={async () => {
              if (!batch.barcode_value) return;
              await barcodeApi.printLog(batch.barcode_value, { notes: 'mobile label preview' });
              setPrintMsg('Print logged');
            }}
          />
          {printMsg ? <Muted>{printMsg}</Muted> : null}
        </Card>
        <Card>
          <Subtitle>History</Subtitle>
          {history.map((tx) => (
            <Text key={tx.id} style={{ marginBottom: 6 }}>
              {tx.type} {tx.quantity || ''} — {String(tx.created_at).slice(0, 19)}
            </Text>
          ))}
        </Card>
        <Button
          label="Withdraw this batch"
          onPress={() =>
            navigation.navigate('Withdrawal', {
              screen: 'WithdrawalMain',
              params: { batchId: batch.id },
            })
          }
        />
      </ScrollView>
    </Screen>
  );
}
