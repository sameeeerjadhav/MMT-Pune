import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
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
import { useAuth } from '../context/AuthContext';
import { useTabScrollPadding } from '../hooks/useTabScrollPadding';
import { colors, radius } from '../theme/tokens';
import { canAccess, roleLabel } from '../utils/roles';

type FloorCell = {
  row_index: number;
  column_index: number;
  cell_code: string;
  empty: boolean;
  rack: null | {
    id: number;
    code: string;
    name: string;
    barcode_value?: string | null;
    stock_lines: number;
    total_qty: string;
    sections_total: number;
    sections_occupied: number;
    fill_pct: number;
    stock: any[];
    stock_truncated?: boolean;
  };
};

type FloorRow = { row_index: number; cells: FloorCell[] };

function fillTone(pct: number) {
  if (pct <= 0) return { bg: colors.surfaceMuted, border: colors.borderSoft, label: colors.muted };
  if (pct < 40) return { bg: colors.successSoft, border: colors.success, label: colors.success };
  if (pct < 75) return { bg: colors.warningSoft, border: colors.warning, label: colors.warning };
  return { bg: colors.accentSoft, border: colors.accent, label: colors.accent };
}

export default function FloorMapScreen({ route, navigation }: any) {
  const id = route?.params?.id;
  const { user } = useAuth();
  const canEdit = canAccess(user?.role, 'editFloorLayout');
  const scrollPad = useTabScrollPadding(28);
  const loadSeq = useRef(0);

  const [map, setMap] = useState<any>(null);
  const [selected, setSelected] = useState<FloorCell | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [placeOpen, setPlaceOpen] = useState(false);
  const [rowCount, setRowCount] = useState('');
  const [colCount, setColCount] = useState('');
  const [placeRackId, setPlaceRackId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setError('');
    try {
      const { data } = await warehouseApi.floorMap(id);
      if (seq !== loadSeq.current) return;
      setMap(data);
      setRowCount(String(data?.floor?.row_count ?? ''));
      setColCount(String(data?.floor?.column_count ?? ''));
      if (data?.floor?.code) {
        navigation.setOptions({ title: `${data.floor.code} floor` });
      }
      setSelected((prev) => {
        if (!prev) return null;
        for (const row of data.grid || []) {
          const cell = row.cells.find(
            (c: FloorCell) =>
              c.row_index === prev.row_index && c.column_index === prev.column_index
          );
          if (cell) return cell;
        }
        return null;
      });
    } catch (e) {
      if (seq !== loadSeq.current) return;
      setError(getErrorMessage(e));
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [id, navigation]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const columns = useMemo(() => {
    const n = map?.floor?.column_count || 0;
    return Array.from({ length: n }, (_, i) => i + 1);
  }, [map]);

  const roleHint = useMemo(() => {
    if (user?.role === 'ADMIN') {
      return 'Admin: set floor grid size, place large racks, and inspect full section stock.';
    }
    if (user?.role === 'SUPERVISOR') {
      return 'Supervisor: adjust layout, place racks, and guide floor stock moves.';
    }
    return 'Employee: find which big rack holds stock, then open it to allocate or transfer.';
  }, [user?.role]);

  const saveLayout = async () => {
    const rows = parseInt(rowCount, 10);
    const cols = parseInt(colCount, 10);
    if (!rows || !cols) {
      setError('Enter valid rows and columns');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await warehouseApi.updateFloorLayout(id, { row_count: rows, column_count: cols });
      setEditOpen(false);
      await load();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const placeRack = async () => {
    if (!selected || !placeRackId) {
      setError('Select an empty cell and a rack to place');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await warehouseApi.placeRack(id, {
        rack_id: placeRackId,
        row_index: selected.row_index,
        column_index: selected.column_index,
      });
      setPlaceOpen(false);
      setPlaceRackId(null);
      await load();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  if (!id) return <ErrorState message="Missing floor id" />;
  if (loading && !map) return <LoadingState />;
  if (error && !map) return <ErrorState message={error} onRetry={load} />;
  if (!map) return <ErrorState message="Floor map unavailable" onRetry={load} />;

  const floor = map.floor || {};
  const summary = map.summary || {};
  const unplaced: any[] = map.unplaced_racks || [];
  const availableRacks: any[] = map.available_racks || unplaced;

  return (
    <Screen style={{ padding: 0 }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: scrollPad }} nestedScrollEnabled>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <RackIcon size={22} color={colors.primaryDark} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: '800', color: colors.navy, fontSize: 18 }}>
              {floor.name || floor.code}
            </Text>
            <Muted>
              {floor.warehouse_code} ? Level {floor.level} ? Grid {floor.row_count}?{floor.column_count}
            </Muted>
          </View>
          <Badge label={roleLabel(user?.role)} tone="primary" />
        </View>

        <View style={{ marginBottom: 12 }}>
          <Muted>{roleHint}</Muted>
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          <Metric label="Cells" value={summary.cells ?? 0} />
          <Metric label="Racks placed" value={summary.placed_racks ?? 0} />
          <Metric label="With stock" value={summary.occupied_racks ?? 0} />
          <Metric label="Empty bays" value={summary.empty_cells ?? 0} />
        </View>

        {canEdit ? (
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
            <View style={{ flex: 1 }}>
              <Button label="Edit grid size" variant="secondary" onPress={() => setEditOpen(true)} />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                label="Place rack"
                variant="ghost"
                onPress={() => {
                  if (!selected || !selected.empty) {
                    setError('Tap an empty bay first, then place a rack');
                    return;
                  }
                  setPlaceOpen(true);
                }}
              />
            </View>
          </View>
        ) : null}

        {error ? <Text style={{ color: colors.danger, marginBottom: 8 }}>{error}</Text> : null}

        <Card>
          <Subtitle>Floor rack map</Subtitle>
          <Muted>
            Each cell is one large rack bay. Color shows how full the rack sections are. Tap a bay
            for stock, then open the rack map for shelf ? position detail.
          </Muted>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator
            nestedScrollEnabled
            {...(Platform.OS === 'android' ? { nestedScrollEnabled: true } : null)}
          >
            <View style={{ paddingTop: 12, minWidth: 280 }}>
              <View style={{ flexDirection: 'row', marginBottom: 6, alignItems: 'center' }}>
                <View style={{ width: 44 }} />
                {columns.map((c) => (
                  <View
                    key={`h-${c}`}
                    style={{ width: 96, marginHorizontal: 4, alignItems: 'center' }}
                  >
                    <Text style={{ fontSize: 11, fontWeight: '800', color: colors.muted }}>COL {c}</Text>
                  </View>
                ))}
              </View>

              {(map.grid as FloorRow[]).map((row) => (
                <View
                  key={`r-${row.row_index}`}
                  style={{ flexDirection: 'row', marginBottom: 8, alignItems: 'center' }}
                >
                  <View style={{ width: 44, paddingRight: 4 }}>
                    <Text style={{ fontSize: 12, fontWeight: '800', color: colors.navy }}>
                      ROW {row.row_index}
                    </Text>
                  </View>
                  {row.cells.map((cell) => {
                    const active =
                      selected?.row_index === cell.row_index &&
                      selected?.column_index === cell.column_index;
                    if (cell.empty) {
                      return (
                        <Pressable
                          key={cell.cell_code}
                          onPress={() => setSelected(cell)}
                          style={{
                            width: 96,
                            height: 88,
                            marginHorizontal: 4,
                            borderRadius: radius.md,
                            borderWidth: active ? 2 : 1,
                            borderColor: active ? colors.primary : colors.border,
                            borderStyle: 'dashed',
                            backgroundColor: colors.backgroundAlt,
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: 6,
                          }}
                        >
                          <Text style={{ fontSize: 11, fontWeight: '700', color: colors.muted }}>
                            {cell.cell_code}
                          </Text>
                          <Text style={{ fontSize: 10, color: colors.muted, marginTop: 4 }}>Empty bay</Text>
                        </Pressable>
                      );
                    }
                    const rack = cell.rack!;
                    const tone = fillTone(rack.fill_pct);
                    return (
                      <Pressable
                        key={cell.cell_code}
                        onPress={() => setSelected(cell)}
                        style={{
                          width: 96,
                          height: 88,
                          marginHorizontal: 4,
                          borderRadius: radius.md,
                          backgroundColor: tone.bg,
                          borderWidth: active ? 2 : 1,
                          borderColor: active ? colors.primary : tone.border,
                          padding: 8,
                          justifyContent: 'space-between',
                        }}
                      >
                        <Text style={{ fontWeight: '800', color: colors.navy, fontSize: 13 }} numberOfLines={1}>
                          {rack.code}
                        </Text>
                        <Text style={{ fontSize: 10, color: colors.muted }} numberOfLines={1}>
                          {rack.sections_occupied}/{rack.sections_total} sec
                        </Text>
                        <Text style={{ fontSize: 11, fontWeight: '700', color: tone.label }}>
                          {rack.fill_pct}% ? {rack.stock_lines} stock
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </View>
          </ScrollView>

          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <Badge label="Empty bay" tone="warning" />
            <Badge label="Light fill" tone="success" />
            <Badge label="Busy" tone="warning" />
            <Badge label="Heavy" tone="danger" />
          </View>
        </Card>

        {selected ? (
          <Card>
            <Subtitle>
              {selected.empty
                ? `Empty bay ${selected.cell_code}`
                : `Rack ${selected.rack?.code} ? ${selected.cell_code}`}
            </Subtitle>
            {selected.empty ? (
              <Muted>
                {canEdit
                  ? 'Place a large rack here to start loading stock into its sections.'
                  : 'No rack assigned to this bay yet. Ask a supervisor to place one.'}
              </Muted>
            ) : (
              <>
                <Muted>
                  {selected.rack?.name} ? Qty {selected.rack?.total_qty} ? Fill{' '}
                  {selected.rack?.fill_pct}%
                </Muted>
                {(selected.rack?.stock || []).length === 0 ? (
                  <Muted>No stock loaded in this rack yet.</Muted>
                ) : (
                  selected.rack!.stock.map((s) => (
                    <View
                      key={s.allocation_id}
                      style={{
                        marginTop: 10,
                        paddingTop: 10,
                        borderTopWidth: 1,
                        borderTopColor: colors.borderSoft,
                      }}
                    >
                      <Text style={{ fontWeight: '800', color: colors.navy }}>
                        {s.batch_code || s.unit_code}
                        {s.section ? ` ? ${s.section}` : ''}
                      </Text>
                      <Muted>
                        {s.item_code ? `${s.item_code} ? ` : ''}
                        {s.item_name || 'Item'}
                      </Muted>
                      <Text style={{ color: colors.text, marginTop: 2 }}>Qty {s.quantity ?? '?'}</Text>
                    </View>
                  ))
                )}
                {selected.rack?.stock_truncated ? (
                  <Muted>Showing top stock lines ? open the rack map for every section.</Muted>
                ) : null}

                <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                  <View style={{ flex: 1 }}>
                    <Button
                      label="Open rack sections"
                      onPress={() => navigation.navigate('RackMap', { id: selected.rack!.id })}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button
                      label="Rack detail"
                      variant="secondary"
                      onPress={() => navigation.navigate('RackDetail', { id: selected.rack!.id })}
                    />
                  </View>
                </View>
              </>
            )}
          </Card>
        ) : (
          <Card>
            <Muted>Tap a bay on the floor map to inspect stock or open that rack?s sections.</Muted>
          </Card>
        )}

        {unplaced.length > 0 ? (
          <Card>
            <Subtitle>Unplaced racks ({unplaced.length})</Subtitle>
            <Muted>
              {canEdit
                ? 'These racks belong to this floor but are not on the grid yet.'
                : 'Some racks are not on the floor grid yet.'}
            </Muted>
            {unplaced.map((r) => (
              <Text key={r.id} style={{ marginTop: 6, color: colors.text, fontWeight: '600' }}>
                {r.code} ? {r.name}
                {r.stock_lines ? ` ? ${r.stock_lines} stock` : ''}
              </Text>
            ))}
          </Card>
        ) : null}

        <Button label="Refresh floor map" variant="secondary" onPress={load} />
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
            <Subtitle>Floor grid size</Subtitle>
            <Muted>How many large rack rows and columns on this floor.</Muted>
            <Text style={{ marginTop: 12, fontWeight: '700', color: colors.navy }}>Rows</Text>
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
            <Text style={{ marginTop: 12, fontWeight: '700', color: colors.navy }}>Columns</Text>
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
                <Button label="Save layout" onPress={saveLayout} loading={saving} />
              </View>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={placeOpen} transparent animationType="fade" onRequestClose={() => setPlaceOpen(false)}>
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
              maxHeight: '70%',
            }}
          >
            <Subtitle>
              Place rack at {selected?.cell_code || '?'}
            </Subtitle>
            <Muted>Choose an unplaced rack for this bay.</Muted>
            <ScrollView style={{ marginTop: 12 }}>
              {availableRacks.length === 0 ? (
                <Muted>No free racks in this warehouse. Create a rack first from the list.</Muted>
              ) : (
                availableRacks.map((r) => (
                  <Pressable key={r.id} onPress={() => setPlaceRackId(r.id)}>
                    <Text
                      style={{
                        paddingVertical: 10,
                        fontWeight: placeRackId === r.id ? '800' : '500',
                        color: placeRackId === r.id ? colors.primary : colors.text,
                      }}
                    >
                      {r.code} ? {r.name}
                    </Text>
                  </Pressable>
                ))
              )}
            </ScrollView>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
              <View style={{ flex: 1 }}>
                <Button label="Cancel" variant="ghost" onPress={() => setPlaceOpen(false)} />
              </View>
              <View style={{ flex: 1 }}>
                <Button label="Place" onPress={placeRack} loading={saving} />
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
