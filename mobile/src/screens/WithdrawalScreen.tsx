import React, { useEffect, useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { inventoryApi, withdrawalApi } from '../api/endpoints';
import { getErrorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Button, Card, FifoAlert, Input, Muted, Screen, Subtitle, Title } from '../components/ui';
import { colors } from '../theme/tokens';

export default function WithdrawalScreen({ route, navigation }: any) {
  const { user } = useAuth();
  const initialBatchId = route.params?.batchId ? String(route.params.batchId) : '';
  const initialUnitId = route.params?.unitId ? String(route.params.unitId) : '';
  const [purpose, setPurpose] = useState<'SHIPMENT' | 'ASSEMBLY'>('SHIPMENT');
  const [batchId, setBatchId] = useState(initialBatchId);
  const [unitId, setUnitId] = useState(initialUnitId);
  const [quantity, setQuantity] = useState('5');
  const [overrideReason, setOverrideReason] = useState('');
  const [validation, setValidation] = useState<any>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (initialBatchId || initialUnitId) {
      validate();
    }
  }, []);

  const validate = async () => {
    setError('');
    try {
      const payload: any = {};
      if (batchId) {
        payload.batch_id = Number(batchId);
        payload.quantity = Number(quantity);
      } else if (unitId) {
        payload.unit_id = Number(unitId);
      }
      const { data } = await withdrawalApi.validate(payload);
      setValidation(data);
    } catch (e) {
      setError(getErrorMessage(e));
      setValidation(null);
    }
  };

  const confirm = async () => {
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const payload: any = {
        purpose,
        override_reason: overrideReason || undefined,
      };
      if (batchId) {
        payload.batch_id = Number(batchId);
        payload.quantity = Number(quantity);
      } else {
        payload.unit_id = Number(unitId);
      }
      const { data } = await withdrawalApi.create(payload);
      setSuccess(`Withdrawal #${data.id} completed`);
      navigation.navigate('WithdrawalConfirm', { id: data.id });
    } catch (e: any) {
      const details = e?.response?.data?.details;
      if (e?.response?.data?.code === 'FIFO_VIOLATION') {
        setValidation({ fifo: details || e.response.data });
      }
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const canOverride = user?.role === 'ADMIN' || user?.role === 'SUPERVISOR';
  const fifoBlocked = validation?.fifo && validation.fifo.eligible === false;

  return (
    <Screen>
      <ScrollView>
        <Title>Withdrawal</Title>
        <Muted>Backend validates stock and FIFO inside a DB transaction.</Muted>

        <Card>
          <Subtitle>Purpose</Subtitle>
          <Button
            label="Shipment"
            variant={purpose === 'SHIPMENT' ? 'primary' : 'secondary'}
            onPress={() => setPurpose('SHIPMENT')}
          />
          <Button
            label="Assembly"
            variant={purpose === 'ASSEMBLY' ? 'success' : 'secondary'}
            onPress={() => setPurpose('ASSEMBLY')}
          />
        </Card>

        <Card>
          <Input placeholder="Batch ID (bulk)" value={batchId} onChangeText={(t) => { setBatchId(t); setUnitId(''); }} keyboardType="numeric" />
          <Input placeholder="Unit ID (individual)" value={unitId} onChangeText={(t) => { setUnitId(t); setBatchId(''); }} keyboardType="numeric" />
          {batchId ? (
            <Input placeholder="Quantity" value={quantity} onChangeText={setQuantity} keyboardType="numeric" />
          ) : null}
          <Button label="Validate FIFO / stock" variant="secondary" onPress={validate} />
          <Button
            label="Load BATCH-002 for FIFO demo"
            variant="secondary"
            onPress={async () => {
              const inv = await inventoryApi.list({ q: 'BATCH-002' });
              const batch = inv.data.batches?.[0];
              if (batch) {
                setBatchId(String(batch.id));
                setUnitId('');
                setQuantity('5');
              }
            }}
          />
        </Card>

        {validation ? (
          <Card>
            <Subtitle>Validation</Subtitle>
            <Text>{validation.type} {validation.batch_code || validation.unit_code}</Text>
            {validation.available_qty ? <Text>Available: {validation.available_qty}</Text> : null}
            {validation.location ? (
              <Text>
                Loc: {validation.location.warehouse}/{validation.location.rack}/{validation.location.shelf}/
                {validation.location.position}
              </Text>
            ) : null}
            {validation.fifo && !validation.fifo.eligible ? (
              <FifoAlert message={validation.fifo.message} older={validation.fifo.older} />
            ) : (
              <Muted>FIFO OK</Muted>
            )}
          </Card>
        ) : null}

        {(fifoBlocked || error.includes('FIFO')) && canOverride ? (
          <Card>
            <Subtitle>Supervisor override</Subtitle>
            <Input
              placeholder="Mandatory override reason"
              value={overrideReason}
              onChangeText={setOverrideReason}
            />
          </Card>
        ) : null}

        {error ? <Text style={{ color: colors.danger, marginBottom: 8 }}>{error}</Text> : null}
        {success ? <Text style={{ color: colors.success }}>{success}</Text> : null}
        <Button label="Confirm withdrawal" onPress={confirm} loading={loading} />
      </ScrollView>
    </Screen>
  );
}

export function WithdrawalConfirmScreen({ route }: any) {
  const { id } = route.params;
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    withdrawalApi.detail(id).then((r) => setData(r.data));
  }, [id]);

  return (
    <Screen>
      <Title>Confirmed</Title>
      {data ? (
        <Card>
          <Subtitle>Withdrawal #{data.id}</Subtitle>
          <Text>Purpose: {data.purpose}</Text>
          <Text>By: {data.user_name || data.user}</Text>
          {(data.lines || []).map((l: any) => (
            <Text key={l.id}>
              {l.batch_code || l.unit_code} qty {l.quantity}
              {l.fifo_override ? ' (FIFO OVERRIDE)' : ''}
            </Text>
          ))}
        </Card>
      ) : (
        <Muted>Loading...</Muted>
      )}
    </Screen>
  );
}
