import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { inventoryApi, withdrawalApi } from '../api/endpoints';
import { getErrorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Button, Card, FifoAlert, Input, LoadingState, Muted, Screen, Subtitle, Title } from '../components/ui';
import { colors } from '../theme/tokens';

export default function WithdrawalScreen({ route, navigation }: any) {
  const { user } = useAuth();
  const paramBatchId = route.params?.batchId != null ? String(route.params.batchId) : '';
  const paramUnitId = route.params?.unitId != null ? String(route.params.unitId) : '';
  const [purpose, setPurpose] = useState<'SHIPMENT' | 'ASSEMBLY'>('SHIPMENT');
  const [batchId, setBatchId] = useState(paramBatchId);
  const [unitId, setUnitId] = useState(paramUnitId);
  const [quantity, setQuantity] = useState('5');
  const [overrideReason, setOverrideReason] = useState('');
  const [validation, setValidation] = useState<any>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  const loadHistory = async () => {
    try {
      const { data } = await withdrawalApi.list();
      setHistory(Array.isArray(data) ? data : data.results || []);
    } catch {
      // list is secondary; ignore hard failure on main form
    } finally {
      setHistoryLoading(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      setHistoryLoading(true);
      loadHistory();
    }, [])
  );

  const validate = useCallback(
    async (overrideBatchId?: string, overrideUnitId?: string, overrideQty?: string) => {
      const nextBatchId = overrideBatchId ?? batchId;
      const nextUnitId = overrideUnitId ?? unitId;
      const nextQty = overrideQty ?? quantity;
      setError('');
      try {
        const payload: any = {};
        if (nextBatchId) {
          payload.batch_id = Number(nextBatchId);
          payload.quantity = Number(nextQty);
        } else if (nextUnitId) {
          payload.unit_id = Number(nextUnitId);
        } else {
          setError('Enter a batch or unit');
          return;
        }
        const { data } = await withdrawalApi.validate(payload);
        setValidation(data);
      } catch (e) {
        setError(getErrorMessage(e));
        setValidation(null);
      }
    },
    [batchId, unitId, quantity]
  );

  // Sync route params and validate with those values (avoids stale state race).
  useEffect(() => {
    if (paramBatchId) {
      setBatchId(paramBatchId);
      setUnitId('');
      validate(paramBatchId, '', quantity);
      return;
    }
    if (paramUnitId) {
      setUnitId(paramUnitId);
      setBatchId('');
      validate('', paramUnitId, quantity);
    }
  }, [paramBatchId, paramUnitId]);

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
      await loadHistory();
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
          <Input
            placeholder="Batch ID (bulk)"
            value={batchId}
            onChangeText={(t) => {
              setBatchId(t);
              setUnitId('');
            }}
            keyboardType="numeric"
          />
          <Input
            placeholder="Unit ID (individual)"
            value={unitId}
            onChangeText={(t) => {
              setUnitId(t);
              setBatchId('');
            }}
            keyboardType="numeric"
          />
          {batchId ? (
            <Input placeholder="Quantity" value={quantity} onChangeText={setQuantity} keyboardType="numeric" />
          ) : null}
          <Button label="Validate FIFO / stock" variant="secondary" onPress={() => validate()} />
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
            <Text>
              {validation.type} {validation.batch_code || validation.unit_code}
            </Text>
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

        <Card>
          <Subtitle>Recent withdrawals</Subtitle>
          {historyLoading ? (
            <LoadingState />
          ) : history.length === 0 ? (
            <Muted>No withdrawals yet</Muted>
          ) : (
            history.slice(0, 15).map((w) => (
              <Pressable key={w.id} onPress={() => navigation.navigate('WithdrawalConfirm', { id: w.id })}>
                <Text style={{ paddingVertical: 6, fontWeight: '600' }}>
                  #{w.id} · {w.purpose}
                </Text>
                <Muted>
                  {w.user_name || w.user} · {String(w.created_at).slice(0, 19)}
                </Muted>
              </Pressable>
            ))
          )}
        </Card>
      </ScrollView>
    </Screen>
  );
}

export function WithdrawalConfirmScreen({ route }: any) {
  const { id } = route.params;
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    withdrawalApi
      .detail(id)
      .then((r) => setData(r.data))
      .catch((e) => setError(getErrorMessage(e)));
  }, [id]);

  return (
    <Screen>
      <Title>Confirmed</Title>
      {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
      {data ? (
        <Card>
          <Subtitle>Withdrawal #{data.id}</Subtitle>
          <Text>Purpose: {data.purpose}</Text>
          <Text>By: {data.user_name || data.user}</Text>
          <Text>At: {String(data.created_at).slice(0, 19)}</Text>
          {(data.lines || []).map((l: any) => (
            <Text key={l.id} style={{ marginTop: 8 }}>
              {l.batch_code || l.unit_code} qty {l.quantity}
              {l.fifo_override ? ' (FIFO OVERRIDE)' : ''}
            </Text>
          ))}
        </Card>
      ) : !error ? (
        <Muted>Loading...</Muted>
      ) : null}
    </Screen>
  );
}
