import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
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
  Metric,
  Muted,
  Screen,
  Subtitle,
} from '../components/ui';
import { MapSkeleton } from '../components/Skeleton';
import { useTabScrollPadding } from '../hooks/useTabScrollPadding';
import { colors, radius } from '../theme/tokens';
import { canAccess, roleLabel } from '../utils/roles';

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

const SCROLL_DURATION_MS = 560;

export default function RackMapScreen({ route, navigation }: any) {
  const id = route?.params?.id;
  const { user } = useAuth();
  const canManage = canAccess(user?.role, 'manageMasterData');
  // Same lead gate as floor maps (Admin + Supervisor).
  const canEditLayout = canAccess(user?.role, 'editFloorLayout') || canAccess(user?.role, 'createRack');
  const scrollPad = useTabScrollPadding(28);
  const loadSeq = useRef(0);
  const scrollRef = useRef<ScrollView | null>(null);
  const cellCardY = useRef(0);
  const scrollOffset = useRef(0);
  const pendingCellScroll = useRef(false);
  const scrollAnimRef = useRef<Animated.CompositeAnimation | null>(null);
  const isSmoothScrolling = useRef(false);
  const [map, setMap] = useState<any>(null);
  const [selectedPositionId, setSelectedPositionId] = useState<number | null>(null);
  const [selectedStockId, setSelectedStockId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionMsg, setActionMsg] = useState('');
  const [deallocating, setDeallocating] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [rowCount, setRowCount] = useState('');
  const [colCount, setColCount] = useState('');
  const [savingLayout, setSavingLayout] = useState(false);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setError('');
    try {
      const { data } = await warehouseApi.rackMap(id);
      if (seq !== loadSeq.current) return;
      setMap(data);
      setRowCount(String(data?.summary?.row_count ?? data?.summary?.shelves ?? ''));
      setColCount(String(data?.summary?.column_count ?? ''));
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

  const smoothScrollTo = useCallback((toY: number) => {
    const target = Math.max(toY, 0);
    const from = scrollOffset.current;
    if (Math.abs(target - from) < 2) return;

    scrollAnimRef.current?.stop();
    isSmoothScrolling.current = true;
    const progress = new Animated.Value(0);
    const listenerId = progress.addListener(({ value }) => {
      const y = from + (target - from) * value;
      scrollOffset.current = y;
      scrollRef.current?.scrollTo({ y, animated: false });
    });

    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: SCROLL_DURATION_MS,
      easing: Easing.bezier(0.22, 1, 0.36, 1),
      useNativeDriver: false,
    });
    scrollAnimRef.current = anim;
    anim.start(({ finished }) => {
      progress.removeListener(listenerId);
      scrollAnimRef.current = null;
      isSmoothScrolling.current = false;
      if (finished) {
        scrollOffset.current = target;
        scrollRef.current?.scrollTo({ y: target, animated: false });
      }
    });
  }, []);

  const selectCell = useCallback(
    (cell: Cell) => {
      setSelectedPositionId(cell.position_id);
      setSelectedStockId(cell.stock[0]?.allocation_id ?? null);
      pendingCellScroll.current = true;
      // If the cell card is already on screen, ease there now; otherwise onLayout will.
      requestAnimationFrame(() => {
        if (!pendingCellScroll.current) return;
        if (cellCardY.current > 0) {
          pendingCellScroll.current = false;
          smoothScrollTo(Math.max(cellCardY.current - 16, 0));
        }
      });
    },
    [smoothScrollTo]
  );

  const openStockDetails = useCallback(
    (s: any, shelfCode: string, cell: Cell) => {
      const rackInfo = map?.rack || {};
      navigation.navigate('AllocationDetail', {
        allocationId: s.allocation_id,
        batchId: s.batch_id ?? null,
        unitId: s.unit_id ?? null,
        quantity: s.quantity ?? null,
        location: `${rackInfo.warehouse_code}/${rackInfo.code}/${shelfCode}/${cell.position_code}`,
        warehouseCode: rackInfo.warehouse_code,
        warehouseName: rackInfo.warehouse_name,
        rackId: id,
        rackCode: rackInfo.code,
        shelfCode,
        positionCode: cell.position_code,
        positionId: cell.position_id,
      });
    },
    [id, map, navigation]
  );

  // Must run before any early return (Rules of Hooks).
  const allowEdit = Boolean(canEditLayout || map?.can_edit_layout);
  React.useEffect(() => {
    navigation.setOptions({
      headerRight: allowEdit
        ? () => (
            <Pressable
              onPress={() => setEditOpen(true)}
              hitSlop={10}
              style={{ paddingHorizontal: 12, paddingVertical: 6 }}
            >
              <Text style={{ color: colors.primaryDark, fontWeight: '800', fontSize: 15 }}>Edit</Text>
            </Pressable>
          )
        : undefined,
    });
  }, [navigation, allowEdit]);

  if (!id) return <ErrorState message="Missing rack id" />;
  if (loading && !map) return <MapSkeleton />;
  if (error && !map) return <ErrorState message={error} onRetry={load} />;
  if (!map) return <ErrorState message="Rack map unavailable" onRetry={load} />;

  const summary = map.summary || {};
  const rack = map.rack || {};
  const currentRows = Number(summary.row_count ?? summary.shelves ?? 0);
  const currentCols = Number(summary.column_count ?? 0);
  const positionLabel = selected
    ? `${rack.warehouse_code}/${rack.code}/${selected.shelf}/${selected.cell.position_code}`
    : '';

  const applyLayout = async (rows: number, cols: number, closeModal = true) => {
    if (!rows || !cols || rows < 1 || cols < 1) {
      setError('Enter valid rows and columns (at least 1)');
      return;
    }
    setSavingLayout(true);
    setError('');
    setActionMsg('');
    try {
      const { data } = await warehouseApi.updateRackLayout(id, {
        row_count: rows,
        column_count: cols,
      });
      setMap(data);
      setRowCount(String(data?.summary?.row_count ?? rows));
      setColCount(String(data?.summary?.column_count ?? cols));
      if (closeModal) setEditOpen(false);
      setActionMsg(`Layout updated to ${rows}×${cols}`);
      setSelectedPositionId(null);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setSavingLayout(false);
    }
  };

  const saveLayout = () => applyLayout(parseInt(rowCount, 10), parseInt(colCount, 10), true);

  return (
    <Screen style={{ padding: 0 }}>
      <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false}
        ref={scrollRef}
        contentContainerStyle={{ padding: 16, paddingBottom: scrollPad }}
        nestedScrollEnabled
        scrollEventThrottle={16}
        onScroll={(e) => {
          // Keep offset in sync when the user scrolls by hand (skip while we animate).
          if (!isSmoothScrolling.current) {
            scrollOffset.current = e.nativeEvent.contentOffset.y;
          }
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <RackIcon size={22} color={colors.primaryDark} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: '800', color: colors.navy, fontSize: 18 }}>
              {rack.code} — {rack.name}
            </Text>
            <Muted>
              {rack.warehouse_code} · {rack.warehouse_name}
              {currentRows && currentCols ? ` · Grid ${currentRows}×${currentCols}` : ''}
            </Muted>
          </View>
          <Badge label={roleLabel(user?.role)} tone="primary" />
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          <Metric label="Shelves (rows)" value={summary.shelves ?? 0} />
          <Metric label="Positions" value={summary.cells ?? 0} />
          <Metric label="Occupied" value={summary.occupied ?? 0} />
          <Metric label="Empty" value={summary.empty ?? 0} />
        </View>

        {allowEdit ? (
          <Card>
            <Subtitle>Edit rack layout</Subtitle>
            <Muted>Change shelves (rows) and positions (columns). Shrinking only removes empty cells.</Muted>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
              <View style={{ flex: 1 }}>
                <Button
                  label="+ Shelf (row)"
                  variant="secondary"
                  loading={savingLayout}
                  onPress={() => applyLayout(currentRows + 1, Math.max(currentCols, 1), false)}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  label="+ Column"
                  variant="secondary"
                  loading={savingLayout}
                  onPress={() => applyLayout(Math.max(currentRows, 1), currentCols + 1, false)}
                />
              </View>
            </View>
            <View style={{ marginTop: 8 }}>
              <Button label="Set exact grid size…" onPress={() => setEditOpen(true)} />
            </View>
          </Card>
        ) : (
          <View style={{ marginBottom: 12 }}>
            <Muted>
              Layout editing needs Admin or Supervisor. Your role: {roleLabel(user?.role)}. You can
              still allocate and transfer stock.
            </Muted>
          </View>
        )}

        {error ? <Text style={{ color: colors.danger, marginBottom: 8 }}>{error}</Text> : null}
        {actionMsg ? <Text style={{ color: colors.success, marginBottom: 8 }}>{actionMsg}</Text> : null}

        <Card>
          <Subtitle>Visual rack map</Subtitle>
          <Muted>Rows = shelves · Columns = positions. Tap occupied stock for details & history.</Muted>

          <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false}
            horizontal
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
                          onPress={() => selectCell(cell)}
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
          <View
            onLayout={(e) => {
              cellCardY.current = e.nativeEvent.layout.y;
              if (pendingCellScroll.current) {
                pendingCellScroll.current = false;
                smoothScrollTo(Math.max(e.nativeEvent.layout.y - 16, 0));
              }
            }}
          >
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
                    onPress={() => {
                      setSelectedStockId(s.allocation_id);
                      openStockDetails(s, selected.shelf, selected.cell);
                    }}
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
                    <Muted>Tap for details & history</Muted>
                  </Pressable>
                );
              })
            )}

            {selectedStock?.allocation_id ? (
              <View style={{ marginTop: 12 }}>
                <Button
                  label="View details & history"
                  onPress={() =>
                    openStockDetails(selectedStock, selected.shelf, selected.cell)
                  }
                />
              </View>
            ) : null}

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
          </View>
        ) : (
          <Card>
            <Muted>Select a cell on the map to view stock and allocate / transfer.</Muted>
          </Card>
        )}

        <Button label="Refresh map" variant="secondary" onPress={load} />
      </ScrollView>

      <Modal visible={editOpen} transparent animationType="fade" onRequestClose={() => setEditOpen(false)}>
        <View
          style={{
            flex: 1,
            backgroundColor: colors.overlay,
            justifyContent: 'center',
            padding: 24,
          }}
        >
          <View
            style={{
              backgroundColor: colors.surface,
              borderRadius: radius.lg,
              padding: 20,
            }}
          >
            <Subtitle>Edit rack grid</Subtitle>
            <Muted>
              Rows = shelves (A, B, C…) · Columns = positions (01, 02…). Shrinking only removes empty
              cells.
            </Muted>
            <Text style={{ marginTop: 12, fontWeight: '700', color: colors.navy }}>Rows (shelves)</Text>
            <TextInput
              value={rowCount}
              onChangeText={setRowCount}
              keyboardType="number-pad"
              style={{
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: radius.sm,
                padding: 12,
                marginTop: 6,
                color: colors.text,
              }}
            />
            <Text style={{ marginTop: 12, fontWeight: '700', color: colors.navy }}>
              Columns (positions)
            </Text>
            <TextInput
              value={colCount}
              onChangeText={setColCount}
              keyboardType="number-pad"
              style={{
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: radius.sm,
                padding: 12,
                marginTop: 6,
                color: colors.text,
              }}
            />
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
              <View style={{ flex: 1 }}>
                <Button label="Cancel" variant="ghost" onPress={() => setEditOpen(false)} />
              </View>
              <View style={{ flex: 1 }}>
                <Button label="Save layout" onPress={saveLayout} loading={savingLayout} />
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
