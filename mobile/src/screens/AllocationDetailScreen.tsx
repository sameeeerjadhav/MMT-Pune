import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { inventoryApi, warehouseApi } from '../api/endpoints';
import { getErrorMessage } from '../api/client';
import { Badge, Button, Card, ErrorState, Muted, Screen, Subtitle } from '../components/ui';
import { DetailSkeleton } from '../components/Skeleton';
import { useTabScrollPadding } from '../hooks/useTabScrollPadding';
import { colors } from '../theme/tokens';

function DetailRow({ label, value }: { label: string; value?: string | number | null }) {
  if (value === undefined || value === null || value === '') return null;
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: 12,
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: colors.borderSoft,
      }}
    >
      <Text style={{ color: colors.muted, fontWeight: '600', fontSize: 13, flex: 1 }}>{label}</Text>
      <Text style={{ color: colors.navy, fontWeight: '700', fontSize: 14, flex: 1.4, textAlign: 'right' }}>
        {String(value)}
      </Text>
    </View>
  );
}

function historyTitle(tx: any) {
  const meta = tx.metadata || {};
  const t =
    tx.display_type ||
    (tx.type === 'ADJUST' && meta.action === 'DEALLOCATE' ? 'DEALLOCATE' : tx.type) ||
    'EVENT';
  if (t === 'RECEIVE') return 'Received (GRN)';
  if (t === 'ALLOCATE') return 'Allocated to rack';
  if (t === 'TRANSFER') return 'Transferred';
  if (t === 'WITHDRAW') return 'Withdrawn';
  if (t === 'DEALLOCATE') return 'Removed from rack';
  if (t === 'FIFO_CHECK') return 'Older-stock check';
  if (t === 'FIFO_OVERRIDE') return 'Older-stock override';
  if (t === 'ADJUST') return 'Adjustment';
  return String(t);
}

function historyBody(tx: any) {
  const parts: string[] = [];
  if (tx.from_location && tx.to_location) {
    parts.push(`${tx.from_location} → ${tx.to_location}`);
  } else if (tx.to_location) {
    parts.push(`To ${tx.to_location}`);
  } else if (tx.from_location) {
    parts.push(`From ${tx.from_location}`);
  }
  if (tx.quantity != null && tx.quantity !== '') parts.push(`Qty ${tx.quantity}`);
  if (tx.user_name) parts.push(tx.user_name);
  if (tx.notes) parts.push(tx.notes);
  if (tx.override_reason) parts.push(tx.override_reason);
  if (tx.withdrawal) parts.push(`Withdrawal #${tx.withdrawal}`);
  return parts.join(' · ') || '—';
}

function activeAllocLocation(detail: any) {
  const alloc = (detail?.allocations || []).find(
    (a: any) => a.is_active && a.allocation_type === 'ACTUAL'
  );
  if (!alloc) return null;
  return {
    location: `${alloc.warehouse}/${alloc.rack}/${alloc.shelf}/${alloc.position_code}`,
    warehouse_code: alloc.warehouse,
    rack_code: alloc.rack,
    shelf_code: alloc.shelf,
    position_code: alloc.position_code,
    quantity: alloc.quantity,
    position_id: alloc.position,
    created_at: alloc.created_at,
  };
}

function buildFromBatch(batch: any, history: any[], params: any) {
  const loc = activeAllocLocation(batch);
  return {
    allocation: {
      id: params.allocationId,
      is_active: true,
      quantity: params.quantity ?? loc?.quantity,
      location: params.location || loc?.location,
      warehouse_code: params.warehouseCode || loc?.warehouse_code,
      warehouse_name: params.warehouseName,
      rack_id: params.rackId,
      rack_code: params.rackCode || loc?.rack_code,
      shelf_code: params.shelfCode || loc?.shelf_code,
      position_code: params.positionCode || loc?.position_code,
      position_id: params.positionId ?? loc?.position_id,
      created_at: loc?.created_at,
    },
    stock: {
      kind: 'BATCH',
      id: batch.id,
      code: batch.batch_code,
      item_id: batch.item?.id,
      item_code: batch.item?.item_code,
      item_name: batch.item?.name,
      uom: batch.item?.uom,
      category: batch.item?.category_name,
      grn_id: null,
      grn_number: batch.grn_number,
      received_at: batch.received_at,
      testing_status: batch.testing_status,
      available_qty: batch.available_qty,
      received_qty: batch.received_qty,
      withdrawn_qty: batch.withdrawn_qty,
      barcode_value: batch.barcode_value,
    },
    history,
  };
}

function buildFromUnit(unit: any, history: any[], params: any) {
  const loc = activeAllocLocation(unit);
  return {
    allocation: {
      id: params.allocationId,
      is_active: true,
      quantity: params.quantity ?? loc?.quantity ?? '1',
      location: params.location || loc?.location,
      warehouse_code: params.warehouseCode || loc?.warehouse_code,
      warehouse_name: params.warehouseName,
      rack_id: params.rackId,
      rack_code: params.rackCode || loc?.rack_code,
      shelf_code: params.shelfCode || loc?.shelf_code,
      position_code: params.positionCode || loc?.position_code,
      position_id: params.positionId ?? loc?.position_id,
      created_at: loc?.created_at,
    },
    stock: {
      kind: 'UNIT',
      id: unit.id,
      code: unit.unit_code,
      item_id: unit.item?.id,
      item_code: unit.item?.item_code,
      item_name: unit.item?.name,
      uom: unit.item?.uom,
      category: unit.item?.category_name,
      grn_id: null,
      grn_number: unit.grn_number,
      received_at: unit.received_at,
      testing_status: unit.testing_status,
      status: unit.status,
      barcode_value: unit.barcode_value,
    },
    history,
  };
}

export default function AllocationDetailScreen({ route, navigation }: any) {
  const params = route?.params || {};
  const allocationId = params.allocationId ?? params.id;
  const batchId = params.batchId ?? null;
  const unitId = params.unitId ?? null;
  const scrollPad = useTabScrollPadding(28);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!allocationId && !batchId && !unitId) return;
    setError('');
    setLoading(true);
    const navParams = route?.params || {};
    try {
      // Prefer dedicated endpoint when deployed; fall back to batch/unit APIs (remote may lag).
      if (allocationId) {
        try {
          const { data: payload } = await warehouseApi.allocation(allocationId);
          setData(payload);
          return;
        } catch (e: any) {
          const status = e?.response?.status;
          const canFallback = Boolean(batchId || unitId);
          // Undeployed route (404/405) → batch/unit APIs. Other errors keep original failure.
          if (!canFallback) throw e;
          if (status && status !== 404 && status !== 405) throw e;
        }
      }

      if (batchId) {
        const [b, h] = await Promise.all([
          inventoryApi.batch(batchId),
          inventoryApi.history('batch', batchId),
        ]);
        setData(buildFromBatch(b.data, h.data || [], navParams));
        return;
      }
      if (unitId) {
        const [u, h] = await Promise.all([
          inventoryApi.unit(unitId),
          inventoryApi.history('unit', unitId),
        ]);
        setData(buildFromUnit(u.data, h.data || [], navParams));
        return;
      }

      throw new Error('Stock details are unavailable on this server yet');
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [allocationId, batchId, unitId, route?.params]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const code = data?.stock?.code;
    if (code) navigation.setOptions({ title: code });
  }, [data?.stock?.code, navigation]);

  if (!allocationId && !batchId && !unitId) {
    return <ErrorState message="Missing stock reference" />;
  }
  if (loading && !data) return <DetailSkeleton />;
  if (error && !data) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <ErrorState message="Allocation not found" onRetry={load} />;

  const alloc = data.allocation || {};
  const stock = data.stock || {};
  const history: any[] = data.history || [];
  const isBatch = stock.kind === 'BATCH';
  const shelfPos =
    alloc.shelf_code && alloc.position_code
      ? `${alloc.shelf_code}/${alloc.position_code}`
      : null;

  return (
    <Screen style={{ padding: 0 }}>
      <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} contentContainerStyle={{ padding: 16, paddingBottom: scrollPad }}>
        <Card>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            <Badge label={stock.kind || 'STOCK'} tone="primary" />
            {stock.testing_status ? (
              <Badge
                label={stock.testing_status}
                tone={stock.testing_status === 'PASSED' ? 'success' : 'warning'}
              />
            ) : null}
            <Badge
              label={alloc.is_active === false ? 'Inactive' : 'On rack'}
              tone={alloc.is_active === false ? 'warning' : 'success'}
            />
          </View>
          <Text style={{ fontSize: 22, fontWeight: '800', color: colors.navy }}>
            {stock.item_name || 'Item'}
          </Text>
          <Muted>
            {stock.item_code ? `${stock.item_code} · ` : ''}
            {stock.code}
            {isBatch ? ' (batch)' : stock.kind === 'UNIT' ? ' (unit)' : ''}
          </Muted>
        </Card>

        <Card>
          <Subtitle>Current location</Subtitle>
          <DetailRow label="Cell" value={alloc.location} />
          <DetailRow label="Warehouse" value={alloc.warehouse_name || alloc.warehouse_code} />
          <DetailRow label="Rack" value={alloc.rack_code} />
          <DetailRow label="Shelf / position" value={shelfPos} />
          <DetailRow label="Allocated qty" value={alloc.quantity} />
          <DetailRow
            label="Allocated at"
            value={alloc.created_at ? String(alloc.created_at).slice(0, 19).replace('T', ' ') : null}
          />
        </Card>

        <Card>
          <Subtitle>Where it came from</Subtitle>
          <DetailRow label="GRN" value={stock.grn_number || '—'} />
          <DetailRow
            label="Received"
            value={stock.received_at ? String(stock.received_at).slice(0, 10) : null}
          />
          <DetailRow label="Item code" value={stock.item_code} />
          <DetailRow label="Category" value={stock.category} />
          <DetailRow label="UOM" value={stock.uom} />
          <DetailRow label="Barcode" value={stock.barcode_value} />
          {isBatch ? (
            <>
              <DetailRow label="Available qty" value={stock.available_qty} />
              <DetailRow label="Received qty" value={stock.received_qty} />
              <DetailRow label="Withdrawn qty" value={stock.withdrawn_qty} />
            </>
          ) : (
            <DetailRow label="Unit status" value={stock.status} />
          )}
          {stock.grn_id ? (
            <View style={{ marginTop: 10 }}>
              <Button
                label="Open GRN"
                variant="secondary"
                onPress={() =>
                  navigation.navigate('GRN', {
                    screen: 'GRNDetail',
                    params: { id: stock.grn_id },
                  })
                }
              />
            </View>
          ) : null}
        </Card>

        <Card>
          <Subtitle>Movement history</Subtitle>
          {history.length === 0 ? <Muted>No history recorded yet</Muted> : null}
          {history.map((tx) => (
            <View
              key={tx.id}
              style={{
                marginTop: 10,
                paddingTop: 10,
                borderTopWidth: 1,
                borderTopColor: colors.borderSoft,
              }}
            >
              <Text style={{ fontWeight: '800', color: colors.navy }}>{historyTitle(tx)}</Text>
              <Muted>{historyBody(tx)}</Muted>
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
                {String(tx.created_at || '').slice(0, 19).replace('T', ' ')}
              </Text>
            </View>
          ))}
        </Card>

        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
          <View style={{ flex: 1 }}>
            <Button
              label={isBatch ? 'Open batch' : 'Open unit'}
              variant="secondary"
              onPress={() => {
                if (!stock.id) return;
                navigation.navigate('Inventory', {
                  screen: isBatch ? 'BatchDetail' : 'UnitDetail',
                  params: { id: stock.id },
                });
              }}
            />
          </View>
          {alloc.rack_id || params.rackId ? (
            <View style={{ flex: 1 }}>
              <Button
                label="Back to rack"
                variant="ghost"
                onPress={() =>
                  navigation.navigate('RackMap', { id: alloc.rack_id || params.rackId })
                }
              />
            </View>
          ) : null}
        </View>

        {(alloc.position_id || params.positionId) && alloc.is_active !== false ? (
          <Button
            label="Transfer this stock"
            onPress={() =>
              navigation.navigate('Transfer', {
                fromPositionId: alloc.position_id || params.positionId,
                batchId: isBatch ? stock.id : null,
                unitId: stock.kind === 'UNIT' ? stock.id : null,
              })
            }
          />
        ) : null}

        {error ? (
          <Pressable onPress={load}>
            <Text style={{ color: colors.danger, marginTop: 8 }}>{error}</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
