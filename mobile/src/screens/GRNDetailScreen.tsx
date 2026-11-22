import React, { useEffect, useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { grnApi } from '../api/endpoints';
import { getErrorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Button, Card, ErrorState, Muted, Screen, Subtitle } from '../components/ui';
import { DetailSkeleton } from '../components/Skeleton';
import { canAccess } from '../utils/roles';

export default function GRNDetailScreen({ route, navigation }: any) {
  const { user } = useAuth();
  const canGenerate = canAccess(user?.role, 'grnImport');
  const id = route?.params?.id;
  const [grn, setGrn] = useState<any>(null);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');

  const load = async () => {
    setError('');
    setLoading(true);
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
    if (id) load();
  }, [id]);

  useEffect(() => {
    if (grn?.grn_number) navigation.setOptions({ title: grn.grn_number });
  }, [grn?.grn_number, navigation]);

  if (!id) return <ErrorState message="Missing GRN id" />;
  if (loading) return <DetailSkeleton />;
  if (error || !grn) return <ErrorState message={error || 'Not found'} onRetry={load} />;

  return (
    <Screen>
      <ScrollView>
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
              setMsg('');
              setActionError('');
              try {
                const { data } = await grnApi.generateBarcodes(id);
                setMsg(`Created ${data.created} barcodes`);
                setGrn(data.grn);
              } catch (e) {
                setActionError(getErrorMessage(e));
              }
            }}
          />
        ) : (
          <Muted>Barcode generation is limited to supervisors and admins.</Muted>
        )}
        {actionError ? <Text style={{ color: '#B91C1C', marginTop: 8 }}>{actionError}</Text> : null}
        {msg ? <Muted>{msg}</Muted> : null}
      </ScrollView>
    </Screen>
  );
}
