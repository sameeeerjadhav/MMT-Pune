import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { inventoryApi, withdrawalApi } from '../api/endpoints';
import { getErrorMessage, SHOW_DEMO_TOOLS } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { OutIcon } from '../components/icons';
import {
  Button,
  Card,
  FifoAlert,
  Input,
  LoadingState,
  Muted,
  Screen,
  SearchInput,
  Subtitle,
} from '../components/ui';
import { PageHeader } from '../components/PageHeader';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useTabScrollPadding } from '../hooks/useTabScrollPadding';
import { colors } from '../theme/tokens';
import { canAccess } from '../utils/roles';

export default function WithdrawalScreen({ route, navigation }: any) {
  const { user } = useAuth();
  const scrollPad = useTabScrollPadding(28);
  const paramBatchId = route.params?.batchId != null ? String(route.params.batchId) : '';
  const paramUnitId = route.params?.unitId != null ? String(route.params.unitId) : '';
  const [purpose, setPurpose] = useState<'SHIPMENT' | 'ASSEMBLY'>('SHIPMENT');
  const [batchId, setBatchId] = useState(paramBatchId);
  const [unitId, setUnitId] = useState(paramUnitId);
  const [quantity, setQuantity] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [validation, setValidation] = useState<any>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const [historyQ, setHistoryQ] = useState('');
  const debouncedHistoryQ = useDebouncedValue(historyQ, 160);
  const historyQRef = useRef(historyQ);
  historyQRef.current = historyQ;
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historySearching, setHistorySearching] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const syncedParams = useRef('');

  const loadHistory = useCallback(async (opts?: { soft?: boolean }) => {
    setHistoryError('');
    if (opts?.soft) setHistorySearching(true);
    else setHistoryLoading(true);
    try {
      const { data } = await withdrawalApi.list({ q: debouncedHistoryQ.trim() || undefined });
      setHistory(Array.isArray(data) ? data : data.results || []);
    } catch (e) {
      setHistoryError(getErrorMessage(e));
    } finally {
      setHistoryLoading(false);
      setHistorySearching(false);
    }
  }, [debouncedHistoryQ]);

  useFocusEffect(
    useCallback(() => {
      void loadHistory({ soft: history.length > 0 });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [debouncedHistoryQ])
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
          setError('Enter a batch ID or unit ID');
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

  const resetFormKey = route.params?.resetKey;

  // Apply route params once per navigation — do not re-lock fields on every keystroke.
  useEffect(() => {
    const key = `${paramBatchId}|${paramUnitId}|${resetFormKey ?? ''}`;
    if (syncedParams.current === key) return;
    syncedParams.current = key;

    // Explicit reset from More/Dashboard (no batch/unit intent).
    if (!paramBatchId && !paramUnitId) {
      if (resetFormKey != null) {
        setBatchId('');
        setUnitId('');
        setQuantity('');
        setOverrideReason('');
        setValidation(null);
        setError('');
        setSuccess('');
      }
      return;
    }

    setOverrideReason('');
    if (paramBatchId) {
      setBatchId(paramBatchId);
      setUnitId('');
      setQuantity('');
      setValidation(null);
      setError('');
      // Prefill qty from batch available so scan/detail deep-links are not stuck on a hard-coded 5.
      void inventoryApi
        .batch(Number(paramBatchId))
        .then(({ data }) => {
          const avail = data?.available_qty;
          if (avail != null && avail !== '') {
            const q = String(avail);
            setQuantity(q);
            void validate(paramBatchId, '', q);
          }
        })
        .catch((e) => setError(getErrorMessage(e)));
      return;
    }
    setUnitId(paramUnitId);
    setBatchId('');
    setQuantity('');
    void validate('', paramUnitId, '1');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when route params change
  }, [paramBatchId, paramUnitId, resetFormKey]);

  const canOverride = canAccess(user?.role, 'fifoOverride');
  const fifoBlocked = validation?.fifo && validation.fifo.eligible === false;

  const confirm = async () => {
    setError('');
    setSuccess('');
    if (!batchId && !unitId) {
      setError('Enter a batch ID or unit ID');
      return;
    }
    if (fifoBlocked && !canOverride) {
      setError('Older stock must be used first — ask a supervisor or admin to override');
      return;
    }
    if (fifoBlocked && canOverride && !overrideReason.trim()) {
      setError('Add a reason to override and withdraw newer stock first');
      return;
    }
    setLoading(true);
    try {
      const payload: any = {
        purpose,
        override_reason: fifoBlocked ? overrideReason.trim() || undefined : undefined,
      };
      if (batchId) {
        payload.batch_id = Number(batchId);
        payload.quantity = Number(quantity);
      } else {
        payload.unit_id = Number(unitId);
      }
      const { data } = await withdrawalApi.create(payload);
      setSuccess(`Withdrawal #${data.id} completed`);
      setBatchId('');
      setUnitId('');
      setQuantity('');
      setOverrideReason('');
      setValidation(null);
      // Drop the deep-link params so a later "Withdraw" for the same stock re-applies them.
      if (paramBatchId || paramUnitId) {
        navigation.setParams({ batchId: undefined, unitId: undefined });
      }
      void loadHistory({ soft: true });
      navigation.navigate('WithdrawalConfirm', { id: data.id });
    } catch (e: any) {
      const details = e?.response?.data?.details;
      if (e?.response?.data?.code === 'FIFO_VIOLATION') {
        setValidation((prev: any) => ({
          ...(prev || {}),
          ...(details && typeof details === 'object' ? details : {}),
          fifo: details?.fifo || details || e.response.data,
        }));
      }
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen style={{ padding: 0 }}>
      <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ padding: 16, paddingBottom: scrollPad }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <PageHeader
          title="Withdrawal"
          safeTop
          right={<OutIcon size={22} color={colors.accent} />}
        />

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
          <Subtitle>Stock to withdraw</Subtitle>
          <Muted>Use batch for bulk items, or unit for serialized items — not both.</Muted>

          <Input
            label="Batch ID"
            placeholder="e.g. 6"
            value={batchId}
            onChangeText={(t) => {
              setBatchId(t);
              if (t) setUnitId('');
              setValidation(null);
              setOverrideReason('');
            }}
            keyboardType="numeric"
          />
          {validation?.batch_code && batchId ? (
            <Muted>Selected batch: {validation.batch_code}</Muted>
          ) : null}

          <Input
            label="Unit ID"
            placeholder="e.g. 12 (leave empty for batch)"
            value={unitId}
            onChangeText={(t) => {
              setUnitId(t);
              if (t) setBatchId('');
              setValidation(null);
              setOverrideReason('');
            }}
            keyboardType="numeric"
          />

          {batchId ? (
            <Input
              label="Quantity"
              placeholder="How many to withdraw"
              value={quantity}
              onChangeText={(t) => {
                setQuantity(t);
                setValidation(null);
              }}
              keyboardType="numeric"
            />
          ) : null}

          <Button label="Check stock & age order" variant="secondary" onPress={() => validate()} />
          {SHOW_DEMO_TOOLS ? (
            <Button
              label="Load BATCH-002 for older-stock demo"
              variant="secondary"
              onPress={async () => {
                setError('');
                try {
                  const inv = await inventoryApi.list({ q: 'BATCH-002' });
                  const batch = inv.data.batches?.[0];
                  if (batch) {
                    const id = String(batch.id);
                    syncedParams.current = '';
                    setBatchId(id);
                    setUnitId('');
                    setQuantity('5');
                    await validate(id, '', '5');
                  } else {
                    setError('BATCH-002 not found in seed data');
                  }
                } catch (e) {
                  setError(getErrorMessage(e));
                }
              }}
            />
          ) : null}
        </Card>

        {validation ? (
          <Card>
            <Subtitle>Validation</Subtitle>
            <Text>
              {validation.type} {validation.batch_code || validation.unit_code}
            </Text>
            {validation.available_qty ? <Text>Available: {validation.available_qty}</Text> : null}
            {validation.location?.warehouse ? (
              <Text>
                Loc: {validation.location.warehouse}/{validation.location.rack}/{validation.location.shelf}/
                {validation.location.position}
              </Text>
            ) : null}
            {validation.fifo && !validation.fifo.eligible ? (
              <FifoAlert message={validation.fifo.message} older={validation.fifo.older} />
            ) : (
              <Muted>Ready — this is the oldest available stock</Muted>
            )}
          </Card>
        ) : null}

        {(fifoBlocked ||
          error.toLowerCase().includes('older stock') ||
          error.includes('FIFO')) &&
        canOverride ? (
          <Card>
            <Subtitle>Supervisor override</Subtitle>
            <Muted>Only use this if you must take newer stock before older stock.</Muted>
            <Input
              label="Override reason"
              placeholder="Why skip older stock?"
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
          <SearchInput
            placeholder="Search purpose, batch, user..."
            value={historyQ}
            onChangeText={setHistoryQ}
            searching={historySearching}
            onClear={() => setHistoryQ('')}
          />
          {historyLoading ? (
            <LoadingState />
          ) : historyError ? (
            <>
              <Text style={{ color: colors.danger, marginBottom: 8 }}>{historyError}</Text>
              <Button
                label="Retry history"
                variant="secondary"
                onPress={() => {
                  void loadHistory();
                }}
              />
            </>
          ) : history.length === 0 ? (
            <Muted>No withdrawals yet</Muted>
          ) : (
            history.slice(0, 25).map((w) => (
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

