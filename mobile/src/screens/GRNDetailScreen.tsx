import React, { useEffect, useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { grnApi } from '../api/endpoints';
import { getErrorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Button, Card, ErrorState, LoadingState, Muted, Screen, Subtitle, Title } from '../components/ui';
import { canAccess } from '../utils/roles';

export default function GRNDetailScreen({ route }: any) {
  const { user } = useAuth();
  const canGenerate = canAccess(user?.role, 'grnImport');
  const { id } = route.params;
  const [grn, setGrn] = useState<any>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');

  const load = async () => {
    try {
      const { data } = await grnApi.detail(id);
      setGrn(data);
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
  if (error || !grn) return <ErrorState message={error || 'Not found'} onRetry={load} />;

  return (
    <Screen>
      <ScrollView>
        <Title>{grn.grn_number}</Title>
        <Muted>
          {grn.external_system} {grn.external_ref || ''} | {String(grn.received_date).slice(0, 10)}
        </Muted>
        {(grn.lines || []).map((line: any) => (
          <Card key={line.id}>
            <Subtitle>{line.item?.name}</Subtitle>
            <Text>
              Qty {line.received_qty} | {line.classification} | {line.testing_status}
            </Text>
            {(line.batches || []).map((b: any) => (
              <Text key={b.id}>Batch {b.batch_code} — {b.barcode_value}</Text>
            ))}
            {(line.units || []).slice(0, 5).map((u: any) => (
              <Text key={u.id}>Unit {u.unit_code} — {u.barcode_value}</Text>
            ))}
          </Card>
        ))}
        {canGenerate ? (
          <Button
            label="Generate missing barcodes"
            variant="secondary"
            onPress={async () => {
              const { data } = await grnApi.generateBarcodes(id);
              setMsg(`Created ${data.created} barcodes`);
              setGrn(data.grn);
            }}
          />
        ) : (
          <Muted>Barcode generation is limited to supervisors and admins.</Muted>
        )}
        {msg ? <Muted>{msg}</Muted> : null}
      </ScrollView>
    </Screen>
  );
}
