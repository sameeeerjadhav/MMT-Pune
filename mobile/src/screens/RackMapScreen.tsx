import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { warehouseApi } from '../api/endpoints';
import { getErrorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { RackIcon } from '../components/icons';
import {
  Badge,
  Button,
  Card,
  ErrorState,
  LoadingState,
  Metric,
  Muted,
  Screen,
  Subtitle,
} from '../components/ui';
import { useTabScrollPadding } from '../hooks/useTabScrollPadding';
import { colors, radius } from '../theme/tokens';
import { canAccess } from '../utils/roles';

type Cell = {
  position_id: number;
  position_code: string;
  occupied: boolean;
  stock_count: number;
  stock: any[];
};

type Row = {
  shelf_id: number;
  shelf_code: string;
  shelf_name: string;
  cells: Cell[];
};

function naturalCompare(a: string, b: string) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

export default function RackMapScreen({ route, navigation }: any) {
  const id = route?.params?.id;
  const { user } = useAuth();
  const canManage = canAccess(user?.role, 'manageMasterData');
  const scrollPad = useTabScrollPadding(28);
  const loadSeq = useRef(0);
  const [map, setMap] = useState<any>(null);
  const [selectedPositionId, setSelectedPositionId] = useState<number | null>(null);
  const [selectedStockId, setSelectedStockId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionMsg, setActionMsg] = useState('');
  const [deallocating, setDeallocating] = useState(false);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setError('');
    try {
      const { data } = await warehouseApi.rackMap(id);
      if (seq !== loadSeq.current) return;
      setMap(data);
      if (data?.rack?.code) {
        navigation.setOptions({ title: `${data.rack.code} map` });
      }
      // Drop selection if the position no longer exists on this rack.
      setSelectedPositionId((prev) => {
        if (prev == null) return null;
        const stillThere = (data.rows || []).some((row: Row) =>
          row.cells.some((c) => c.position_id === prev)
        );
        return stillThere ? prev : null;
      });
    } catch (e) {
      if (seq !== loadSeq.current) return;
      setError(getErrorMessage(e));
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [id, navigation]);

  // Focus-only refresh (avoids duplicate mount fetch from useEffect + focus).
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const columnCodes = useMemo(() => {
    const codes = new Set<string>();
    (map?.rows || []).forEach((row: Row) => {
      row.cells.forEach((c) => codes.add(c.position_code));
    });
    return Array.from(codes).sort(naturalCompare);
  }, [map]);

  const selected = useMemo(() => {
    if (!map || selectedPositionId == null) return null;
    for (const row of map.rows as Row[]) {
      const cell = row.cells.find((c) => c.position_id === selectedPositionId);
      if (cell) return { cell, shelf: row.shelf_code };
    }
    return null;
  }, [map, selectedPositionId]);

  const selectedStock = useMemo(() => {
    if (!selected) return null;
    if (selectedStockId != null) {
      const found = selected.cell.stock.find((s) => s.allocation_id === selectedStockId);
      if (found) return found;
    }
    return selected.cell.stock[0] || null;
  }, [selected, selectedStockId]);

  if (!id) return <ErrorState message="Missing rack id" />;
  if (loading && !map) return <LoadingState />;
  if (error && !map) return <ErrorState message={error} onRetry={load} />;
  if (!map) return <ErrorState message="Rack map unavailable" onRetry={load} />;

  const summary = map.summary || {};
  const rack = map.rack || {};
  const positionLabel = selected
    ? `${rack.warehouse_code}/${rack.code}/${selected.shelf}/${selected.cell.position_code}`
    : '';

  return (
    <Screen style={{ padding: 0 }}>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: scrollPad }}
        nestedScrollEnabled
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <RackIcon size={22} color={colors.primaryDark} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: '800', color: colors.navy, fontSize: 18 }}>
              {rack.code} — {rack.name}
            </Text>
            <Muted>
              {rack.warehouse_code} · {rack.warehouse_name}
            </Muted>
          </View>
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          <Metric label="Shelves (rows)" value={summary.shelves ?? 0} />
          <Metric label="Positions" value={summary.cells ?? 0} />
          <Metric label="Occupied" value={summary.occupied ?? 0} />
          <Metric label="Empty" value={summary.empty ?? 0} />
        </View>

        <Card>
          <Subtitle>Visual rack map</Subtitle>
          <Muted>Rows = shelves · Columns = positions. Tap a cell to manage stock.</Muted>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator
            nestedScrollEnabled
            {...(Platform.OS === 'android' ? { nestedScrollEnabled: true } : null)}
          >
            <View style={{ paddingTop: 12, minWidth: 280 }}>
              <View style={{ flexDirection: 'row', marginBottom: 6, alignItems: 'center' }}>
                <View style={{ width: 52 }} />
                {columnCodes.map((code) => (
                  <View
                    key={`h-${code}`}
                    style={{
                      width: 72,
                      marginHorizontal: 3,
                      alignItems: 'center',
                    }}
                  >
                    <Text style={{ fontSize: 11, fontWeight: '800', color: colors.muted }}>COL {code}</Text>
                  </View>
                ))}
              </View>

              {(map.rows as Row[]).map((row) => {
                const byCode: Record<string, Cell> = {};
                row.cells.forEach((c) => {
                  byCode[c.position_code] = c;
                });
                return (
                  <View key={row.shelf_id} style={{ flexDirection: 'row', marginBottom: 6, alignItems: 'center' }}>
                    <View style={{ width: 52, paddingRight: 4 }}>
                      <Text style={{ fontSize: 12, fontWeight: '800', color: colors.navy }}>ROW {row.shelf_code}</Text>
                    </View>
                    {columnCodes.map((code) => {
                      const cell = byCode[code];
                      if (!cell) {
                        return (
                          <View
                            key={`${row.shelf_id}-empty-${code}`}
                            style={{
                              width: 72,
                              height: 64,
                              marginHorizontal: 3,
                              borderRadius: radius.sm,
                              backgroundColor: colors.borderSoft,
                              opacity: 0.35,
                            }}
                          />
                        );
                      }
                      const active = selectedPositionId === cell.position_id;
                      return (
                        <Pressable
                          key={cell.position_id}
                          onPress={() => {
                            setSelectedPositionId(cell.position_id);
                            setSelectedStockId(cell.stock[0]?.allocation_id ?? null);
                          }}
                          style={{
                            width: 72,
                            height: 64,
                            marginHorizontal: 3,
                            borderRadius: radius.sm,
                            backgroundColor: cell.occupied ? colors.primarySoft : colors.surfaceMuted,
                            borderWidth: active ? 2 : 1,
                            borderColor: active
                              ? colors.primary
                              : cell.occupied
                                ? colors.primary
                                : colors.borderSoft,
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: 4,
                          }}
                        >
                          <Text style={{ fontWeight: '800', color: colors.navy, fontSize: 13 }}>
                            {row.shelf_code}-{cell.position_code}
                          </Text>
                          <Text
                            style={{
                              fontSize: 10,
                              fontWeight: '700',
                              color: cell.occupied ? colors.primaryDark : colors.muted,
                              marginTop: 2,
                            }}
                          >
                            {cell.occupied ? `${cell.stock_count} stock` : 'Empty'}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                );
              })}
            </View>
          </ScrollView>

          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <Badge label="Occupied" tone="primary" />
            <Badge label="Empty" tone="warning" />
          </View>
        </Card>

        {selected ? (
          <Card>
            <Subtitle>
              Cell {selected.shelf}-{selected.cell.position_code}
            </Subtitle>
            <Muted>
              {positionLabel} · Position #{selected.cell.position_id}
            </Muted>
            {selected.cell.stock.length === 0 ? (
              <Muted>No stock in this cell.</Muted>
            ) : (
              selected.cell.stock.map((s) => {
                const active = selectedStock?.allocation_id === s.allocation_id;
                return (
                  <Pressable
                    key={s.allocation_id}
                    onPress={() => setSelectedStockId(s.allocation_id)}
                    style={{
                      marginTop: 10,
                      paddingTop: 10,
                      borderTopWidth: 1,
                      borderTopColor: colors.borderSoft,
                      paddingHorizontal: 8,
                      paddingBottom: 8,
                      borderRadius: radius.sm,
                      backgroundColor: active ? colors.primarySoft : 'transparent',
                    }}
                  >
                    <Text style={{ fontWeight: '800', color: colors.navy }}>
                      {s.batch_code || s.unit_code}
                      {s.unit_id ? ' (unit)' : ' (batch)'}
                    </Text>
                    <Muted>
                      {s.item_code ? `${s.item_code} — ` : ''}
                      {s.item_name || 'Item'}
                    </Muted>
                    <Text style={{ color: colors.text, marginTop: 2 }}>Qty {s.quantity ?? '—'}</Text>
                    {active ? <Muted>Selected for transfer</Muted> : null}
                  </Pressable>
                );
              })
            )}

            <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
              <View style={{ flex: 1 }}>
                <Button
                  label="Allocate here"
                  onPress={() =>
                    navigation.navigate('Allocate', {
                      positionId: selected.cell.position_id,
                      positionLabel,
                    })
                  }
                />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  label="Transfer"
                  variant="secondary"
                  onPress={() =>
                    navigation.navigate('Transfer', {
                      fromPositionId: selected.cell.occupied ? selected.cell.position_id : null,
                      toPositionId: selected.cell.occupied ? null : selected.cell.position_id,
                      batchId: selectedStock?.batch_id ?? null,
                      unitId: selectedStock?.unit_id ?? null,
                    })
                  }
                />
              </View>
            </View>
            {canManage && selectedStock?.allocation_id ? (
              <View style={{ marginTop: 8 }}>
                <Button
                  label="Deallocate selected stock"
                  variant="ghost"
                  loading={deallocating}
                  onPress={async () => {
                    setDeallocating(true);
                    setActionMsg('');
                    setError('');
                    try {
                      await warehouseApi.deallocate({
                        allocation_id: selectedStock.allocation_id,
                        reason: 'Mobile deallocate',
                      });
                      setActionMsg('Stock removed from this cell');
                      setSelectedStockId(null);
                      await load();
                    } catch (e) {
                      setError(getErrorMessage(e));
                    } finally {
                      setDeallocating(false);
                    }
                  }}
                />
              </View>
            ) : null}
            {actionMsg ? <Muted>{actionMsg}</Muted> : null}
          </Card>
        ) : (
          <Card>
            <Muted>Select a cell on the map to view stock and allocate / transfer.</Muted>
          </Card>
        )}

        <Button label="Refresh map" variant="secondary" onPress={load} />
      </ScrollView>
    </Screen>
  );
}
