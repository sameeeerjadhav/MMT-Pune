import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { warehouseApi, inventoryApi } from '../api/endpoints';
import { getErrorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { postOrQueue } from '../services/offlineQueue';
import { RackIcon } from '../components/icons';
import { PageHeader } from '../components/PageHeader';
import {
  Badge,
  Button,
  Card,
  ErrorState,
  FormActions,
  Input,
  ManageActionBar,
  Muted,
  Screen,
  SearchInput,
  SelectionSummary,
  SelectList,
  SelectRow,
  Subtitle,
  TextAction,
} from '../components/ui';
import { DetailSkeleton, MapSkeleton } from '../components/Skeleton';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useTabScrollPadding } from '../hooks/useTabScrollPadding';
import { colors } from '../theme/tokens';
import { canAccess } from '../utils/roles';

type LocationRow = {
  id: number;
  warehouse_id?: number;
  warehouse: string;
  warehouse_name?: string;
  rack_id?: number;
  rack: string;
  rack_name?: string;
  shelf: string;
  position: string;
  cell?: string;
  label: string;
};

function naturalSort(a: string, b: string) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

/** Step picker: Warehouse → Rack → Row/Column (one step visible at a time). */
function LocationCascadePicker({
  title,
  locations,
  selectedId,
  onSelect,
}: {
  title: string;
  locations: LocationRow[];
  selectedId: number | null;
  onSelect: (loc: LocationRow | null) => void;
}) {
  const selected = useMemo(
    () => locations.find((l) => l.id === selectedId) || null,
    [locations, selectedId]
  );
  const [warehouse, setWarehouse] = useState<string | null>(selected?.warehouse ?? null);
  const [rack, setRack] = useState<string | null>(selected?.rack ?? null);
  const lastSelectedRef = useRef<LocationRow | null>(selected);

  useEffect(() => {
    if (selected) {
      lastSelectedRef.current = selected;
      setWarehouse(selected.warehouse);
      setRack(selected.rack);
      return;
    }
    // Parent cleared a prior cell selection — reset wizard only if still parked on that path.
    // Do not wipe when the user advanced/changed warehouse (already updated local state).
    if (selectedId == null && lastSelectedRef.current) {
      const last = lastSelectedRef.current;
      lastSelectedRef.current = null;
      setWarehouse((w) => (w === last.warehouse ? null : w));
      setRack((r) => (r === last.rack ? null : r));
    }
  }, [selected, selectedId]);

  const step: 1 | 2 | 3 = !warehouse ? 1 : !rack ? 2 : 3;

  const warehouses = useMemo(() => {
    const map = new Map<string, string>();
    locations.forEach((l) => {
      if (!map.has(l.warehouse)) map.set(l.warehouse, l.warehouse_name || l.warehouse);
    });
    return Array.from(map.entries())
      .map(([code, name]) => ({ code, name }))
      .sort((a, b) => naturalSort(a.code, b.code));
  }, [locations]);

  const racks = useMemo(() => {
    if (!warehouse) return [];
    const map = new Map<string, string>();
    locations
      .filter((l) => l.warehouse === warehouse)
      .forEach((l) => {
        if (!map.has(l.rack)) map.set(l.rack, l.rack_name || l.rack);
      });
    return Array.from(map.entries())
      .map(([code, name]) => ({ code, name }))
      .sort((a, b) => naturalSort(a.code, b.code));
  }, [locations, warehouse]);

  const cells = useMemo(() => {
    if (!warehouse || !rack) return [];
    return locations
      .filter((l) => l.warehouse === warehouse && l.rack === rack)
      .slice()
      .sort((a, b) => naturalSort(a.shelf, b.shelf) || naturalSort(a.position, b.position));
  }, [locations, warehouse, rack]);

  const warehouseName = warehouses.find((w) => w.code === warehouse)?.name || warehouse;
  const rackName = racks.find((r) => r.code === rack)?.name || rack;

  return (
    <Card>
      <Subtitle>{title}</Subtitle>
      <Muted>
        Step {step} of 3 — {step === 1 ? 'Warehouse' : step === 2 ? 'Rack number' : 'Row / column'}
      </Muted>

      {warehouse ? (
        <View style={styles.stepChipRow}>
          <Pressable
            onPress={() => {
              lastSelectedRef.current = null;
              setWarehouse(null);
              setRack(null);
              onSelect(null);
            }}
            style={styles.stepChip}
          >
            <Text style={styles.stepChipText}>Warehouse: {warehouse}</Text>
            <Text style={styles.stepChipChange}>Change</Text>
          </Pressable>
          {rack ? (
            <Pressable
              onPress={() => {
                // Keep warehouse; only re-pick rack. Clear ref so effect does not wipe warehouse.
                lastSelectedRef.current = null;
                setRack(null);
                onSelect(null);
              }}
              style={styles.stepChip}
            >
              <Text style={styles.stepChipText}>Rack: {rack}</Text>
              <Text style={styles.stepChipChange}>Change</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {step === 1 ? (
        <>
          <Subtitle>Select warehouse</Subtitle>
          <SelectList maxHeight={220} count={warehouses.length} emptyLabel="No warehouses">
            {warehouses.map((w) => (
              <SelectRow
                key={w.code}
                label={w.code}
                subtitle={w.name !== w.code ? w.name : undefined}
                selected={warehouse === w.code}
                onPress={() => {
                  setWarehouse(w.code);
                  setRack(null);
                  onSelect(null);
                }}
              />
            ))}
          </SelectList>
        </>
      ) : null}

      {step === 2 ? (
        <>
          <Subtitle>Select rack number</Subtitle>
          <Muted>In {warehouseName}</Muted>
          <SelectList maxHeight={220} count={racks.length} emptyLabel="No racks in this warehouse">
            {racks.map((r) => (
              <SelectRow
                key={r.code}
                label={r.code}
                subtitle={r.name !== r.code ? r.name : undefined}
                selected={rack === r.code}
                onPress={() => {
                  setRack(r.code);
                  onSelect(null);
                }}
              />
            ))}
          </SelectList>
        </>
      ) : null}

      {step === 3 ? (
        <>
          <Subtitle>Select row / column</Subtitle>
          <Muted>
            {warehouse} / {rackName} — tap a cell
          </Muted>
          <SelectList maxHeight={240} count={cells.length} emptyLabel="No cells on this rack">
            {cells.map((c) => (
              <SelectRow
                key={c.id}
                label={`Row ${c.shelf}  ·  Col ${c.position}`}
                subtitle={c.cell || `${c.shelf}/${c.position}`}
                selected={selectedId === c.id}
                onPress={() => onSelect(c)}
              />
            ))}
          </SelectList>
        </>
      ) : null}

      {selected ? (
        <View style={{ marginTop: 8 }}>
          <Badge label={`Selected · ${selected.label}`} tone="success" />
        </View>
      ) : null}
    </Card>
  );
}

export function WarehouseListScreen({ navigation }: any) {
  const { user } = useAuth();
  const scrollPad = useTabScrollPadding(28);
  const canManage = canAccess(user?.role, 'manageMasterData');
  const canCreate = canAccess(user?.role, 'createRack');
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [racks, setRacks] = useState<any[]>([]);
  const [selectedWarehouse, setSelectedWarehouse] = useState<number | null>(null);
  const [rackQuery, setRackQuery] = useState('');
  const debouncedRackQuery = useDebouncedValue(rackQuery, 160);
  const rackQueryRef = useRef(rackQuery);
  rackQueryRef.current = rackQuery;
  const selectedWhRef = useRef(selectedWarehouse);
  selectedWhRef.current = selectedWarehouse;
  const loadSeq = useRef(0);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [showCreateRack, setShowCreateRack] = useState(false);
  const [showWhForm, setShowWhForm] = useState(false);
  const [editWh, setEditWh] = useState<any | null>(null);
  const [editRack, setEditRack] = useState<any | null>(null);
  const [rackCode, setRackCode] = useState('');
  const [rackName, setRackName] = useState('');
  const [whCode, setWhCode] = useState('');
  const [whName, setWhName] = useState('');
  const [whAddress, setWhAddress] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(
    async (q?: string, warehouseId?: number | null, soft = false) => {
      const seq = ++loadSeq.current;
      if (soft) setSearching(true);
      try {
        const params: any = {};
        if (canManage) params.include_inactive = '1';
        const query = (q ?? debouncedRackQuery).trim();
        const whFilter = warehouseId !== undefined ? warehouseId : selectedWhRef.current;
        const [wh, rackRes] = await Promise.all([
          warehouseApi.warehouses(params),
          warehouseApi.racks({
            ...params,
            q: query || undefined,
            warehouse: whFilter || undefined,
          }),
        ]);
        if (seq !== loadSeq.current) return;
        setWarehouses(wh.data);
        setRacks(rackRes.data);
        setSelectedWarehouse((prev) => {
          if (warehouseId !== undefined) {
            if (warehouseId == null) {
              return wh.data[0]?.id ?? null;
            }
            return warehouseId;
          }
          if (prev && wh.data.some((w: any) => w.id === prev)) return prev;
          return wh.data[0]?.id ?? null;
        });
        setError('');
      } catch (e) {
        if (seq !== loadSeq.current) return;
        setError(getErrorMessage(e));
      } finally {
        if (seq === loadSeq.current) {
          setLoading(false);
          setSearching(false);
        }
      }
    },
    [canManage, debouncedRackQuery]
  );

  useFocusEffect(
    useCallback(() => {
      void load(debouncedRackQuery, undefined, warehouses.length > 0 || racks.length > 0);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [debouncedRackQuery, canManage])
  );

  const filteredRacks =
    selectedWarehouse && !debouncedRackQuery.trim()
      ? racks.filter((r) => r.warehouse === selectedWarehouse || r.warehouse_id === selectedWarehouse)
      : racks;

  const openCreateWarehouse = () => {
    setEditWh(null);
    setWhCode('');
    setWhName('');
    setWhAddress('');
    setShowWhForm(true);
  };

  const openEditWarehouse = (w: any) => {
    setEditWh(w);
    setWhCode(w.code || '');
    setWhName(w.name || '');
    setWhAddress(w.address || '');
    setShowWhForm(true);
  };

  const openCreateRack = () => {
    setEditRack(null);
    setRackCode('');
    setRackName('');
    setShowCreateRack(true);
  };

  const openEditRack = (item: any) => {
    setShowCreateRack(false);
    setEditRack(item);
    setRackCode(item.code || '');
    setRackName(item.name || '');
  };

  const createRack = async () => {
    if (!selectedWarehouse || !rackCode.trim()) {
      setError('Select a warehouse and enter a rack code');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await warehouseApi.createRack({
        warehouse: selectedWarehouse,
        code: rackCode.trim().toUpperCase(),
        name: rackName.trim() || rackCode.trim().toUpperCase(),
      });
      setRackCode('');
      setRackName('');
      setShowCreateRack(false);
      await load();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const saveWarehouse = async () => {
    if (!whCode.trim() || !whName.trim()) {
      setError('Warehouse code and name are required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload = {
        code: whCode.trim().toUpperCase(),
        name: whName.trim(),
        address: whAddress.trim(),
        is_active: editWh ? editWh.is_active !== false : true,
      };
      if (editWh) {
        await warehouseApi.updateWarehouse(editWh.id, payload);
      } else {
        await warehouseApi.createWarehouse(payload);
      }
      setShowWhForm(false);
      setEditWh(null);
      setWhCode('');
      setWhName('');
      setWhAddress('');
      await load();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const saveRackEdit = async () => {
    if (!editRack) return;
    setSaving(true);
    setError('');
    try {
      await warehouseApi.updateRack(editRack.id, {
        name: rackName.trim() || editRack.name,
        code: rackCode.trim().toUpperCase() || editRack.code,
        is_active: editRack.is_active !== false,
      });
      setEditRack(null);
      setRackCode('');
      setRackName('');
      await load();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const toggleWarehouseActive = async (w: any) => {
    const next = w.is_active === false;
    setSaving(true);
    setError('');
    try {
      await warehouseApi.updateWarehouse(w.id, { is_active: next });
      if (editWh?.id === w.id) setEditWh({ ...editWh, is_active: next });
      await load();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const toggleRackActive = async (r: any) => {
    const next = r.is_active === false;
    setSaving(true);
    setError('');
    try {
      await warehouseApi.updateRack(r.id, { is_active: next });
      if (editRack?.id === r.id) setEditRack({ ...editRack, is_active: next });
      await load();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const confirmDeleteWarehouse = (w: any) => {
    Alert.alert('Delete warehouse?', `${w.code} — ${w.name}\nThis cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setSaving(true);
          setError('');
          try {
            await warehouseApi.deleteWarehouse(w.id);
            if (editWh?.id === w.id) {
              setEditWh(null);
              setShowWhForm(false);
            }
            await load(rackQueryRef.current, null);
          } catch (e) {
            setError(getErrorMessage(e));
          } finally {
            setSaving(false);
          }
        },
      },
    ]);
  };

  const confirmDeleteRack = (r: any) => {
    Alert.alert('Delete rack?', `${r.code} — ${r.name}\nThis cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setSaving(true);
          setError('');
          try {
            await warehouseApi.deleteRack(r.id);
            if (editRack?.id === r.id) setEditRack(null);
            await load();
          } catch (e) {
            setError(getErrorMessage(e));
          } finally {
            setSaving(false);
          }
        },
      },
    ]);
  };

  if (loading && !warehouses.length && !racks.length) return <MapSkeleton />;
  if (error && !racks.length && !warehouses.length) return <ErrorState message={error} onRetry={() => load()} />;

  const header = (
    <View>
      <PageHeader
        title="Floors"
        safeTop
        right={<RackIcon size={22} color={colors.primaryDark} />}
      />

      <SearchInput
        placeholder="Search racks..."
        value={rackQuery}
        onChangeText={setRackQuery}
        searching={searching}
        onClear={() => setRackQuery('')}
      />

      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <Subtitle>Warehouses</Subtitle>
          {canManage ? (
            <TextAction
              label={showWhForm && !editWh ? 'Cancel' : '+ Add'}
              onPress={() => {
                if (showWhForm && !editWh) {
                  setShowWhForm(false);
                  return;
                }
                openCreateWarehouse();
              }}
            />
          ) : null}
        </View>

        {warehouses.map((w, idx) => {
          const selected = selectedWarehouse === w.id;
          const active = w.is_active !== false;
          return (
            <View
              key={w.id}
              style={{
                paddingVertical: 12,
                borderTopWidth: idx === 0 ? 0 : StyleSheet.hairlineWidth,
                borderTopColor: colors.borderSoft,
              }}
            >
              <Pressable
                onPress={() => {
                  setSelectedWarehouse(w.id);
                  load(rackQuery, w.id);
                }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                  paddingVertical: 4,
                  paddingHorizontal: 8,
                  borderRadius: 10,
                  backgroundColor: selected ? colors.primarySoft : 'transparent',
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      fontWeight: '700',
                      fontSize: 15,
                      color: selected ? colors.primaryDark : colors.navy,
                    }}
                  >
                    {w.code}
                  </Text>
                  <Muted>{w.name}</Muted>
                </View>
                {!active ? <Badge label="Inactive" tone="danger" /> : null}
                {selected ? <Badge label="Selected" tone="primary" /> : null}
              </Pressable>
              {canManage ? (
                <ManageActionBar
                  isActive={active}
                  disabled={saving}
                  onEdit={() => openEditWarehouse(w)}
                  onToggleActive={() => toggleWarehouseActive(w)}
                  onDelete={() => confirmDeleteWarehouse(w)}
                />
              ) : null}
            </View>
          );
        })}
      </Card>

      {showWhForm && canManage ? (
        <Card>
          <Subtitle>{editWh ? `Edit warehouse` : 'New warehouse'}</Subtitle>
          <Input label="Code" value={whCode} onChangeText={setWhCode} autoCapitalize="characters" />
          <Input label="Name" value={whName} onChangeText={setWhName} />
          <Input label="Address" value={whAddress} onChangeText={setWhAddress} />
          <FormActions
            primaryLabel="Save"
            onPrimary={saveWarehouse}
            loading={saving}
            onCancel={() => {
              setShowWhForm(false);
              setEditWh(null);
            }}
          />
        </Card>
      ) : null}

      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 4 }}>
        <View style={{ flex: 1 }}>
          <Button
            label="Allocate"
            onPress={() =>
              navigation.navigate({
                name: 'Allocate',
                params: { positionId: null, positionLabel: null, resetKey: Date.now() },
                merge: false,
              })
            }
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            label="Transfer"
            variant="secondary"
            onPress={() =>
              navigation.navigate({
                name: 'Transfer',
                params: {
                  fromPositionId: null,
                  toPositionId: null,
                  batchId: null,
                  unitId: null,
                  resetKey: Date.now(),
                },
                merge: false,
              })
            }
          />
        </View>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <Subtitle>Racks ({filteredRacks.length})</Subtitle>
        {canCreate ? (
          <TextAction
            label={showCreateRack ? 'Cancel' : '+ Add rack'}
            onPress={() => {
              if (showCreateRack) {
                setShowCreateRack(false);
                return;
              }
              openCreateRack();
            }}
          />
        ) : null}
      </View>

      {showCreateRack && canCreate ? (
        <Card>
          <Subtitle>New rack</Subtitle>
          <Input
            label="Code"
            placeholder="e.g. R-11"
            value={rackCode}
            onChangeText={setRackCode}
            autoCapitalize="characters"
          />
          <Input label="Name" placeholder="Rack name" value={rackName} onChangeText={setRackName} />
          <FormActions
            primaryLabel="Create rack"
            onPrimary={createRack}
            loading={saving}
            onCancel={() => setShowCreateRack(false)}
          />
        </Card>
      ) : null}

      {editRack && canManage ? (
        <Card>
          <Subtitle>Edit rack</Subtitle>
          <Input label="Code" value={rackCode} onChangeText={setRackCode} autoCapitalize="characters" />
          <Input label="Name" value={rackName} onChangeText={setRackName} />
          <FormActions
            primaryLabel="Save"
            onPrimary={saveRackEdit}
            loading={saving}
            onCancel={() => setEditRack(null)}
            secondary={
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                  marginTop: 12,
                  paddingTop: 10,
                  borderTopWidth: StyleSheet.hairlineWidth,
                  borderTopColor: colors.borderSoft,
                }}
              >
                <TextAction
                  label={editRack.is_active === false ? 'Activate' : 'Deactivate'}
                  tone="muted"
                  onPress={() => toggleRackActive(editRack)}
                  disabled={saving}
                />
                <Text style={{ color: colors.border }}>·</Text>
                <TextAction
                  label="Delete rack"
                  tone="danger"
                  onPress={() => confirmDeleteRack(editRack)}
                  disabled={saving}
                />
              </View>
            }
          />
        </Card>
      ) : null}

      {error ? <Text style={{ color: colors.danger, marginBottom: 8 }}>{error}</Text> : null}
    </View>
  );

  return (
    <Screen>
      <FlatList
        style={{ flex: 1 }}
        data={filteredRacks}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ paddingBottom: scrollPad }}
        ListHeaderComponent={header}
        renderItem={({ item }) => {
          const active = item.is_active !== false;
          return (
            <Card>
              <Pressable onPress={() => navigation.navigate('RackMap', { id: item.id })}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <Text style={{ fontWeight: '800', fontSize: 16, color: colors.navy }}>{item.code}</Text>
                      {!active ? <Badge label="Inactive" tone="danger" /> : null}
                    </View>
                    <Text style={{ color: colors.text, fontWeight: '600', marginTop: 2 }}>{item.name}</Text>
                    <Muted>
                      {item.warehouse_code} · {item.barcode_value}
                    </Muted>
                  </View>
                  <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 13, marginTop: 2 }}>Map →</Text>
                </View>
              </Pressable>
              {canManage ? (
                <ManageActionBar
                  isActive={active}
                  disabled={saving}
                  onEdit={() => openEditRack(item)}
                  onToggleActive={() => toggleRackActive(item)}
                  onDelete={() => confirmDeleteRack(item)}
                />
              ) : null}
            </Card>
          );
        }}
      />
    </Screen>
  );
}

export function RackDetailScreen({ route, navigation }: any) {
  const id = route?.params?.id;
  const [rack, setRack] = useState<any>(null);
  const [inventory, setInventory] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setError('');
    setLoading(true);
    try {
      const [r, inv] = await Promise.all([warehouseApi.rack(id), warehouseApi.rackInventory(id)]);
      setRack(r.data);
      setInventory(inv.data);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [id]);

  useEffect(() => {
    if (rack?.code) navigation.setOptions({ title: rack.code });
  }, [rack?.code, navigation]);

  if (!id) return <ErrorState message="Missing rack id" />;
  if (loading) return <DetailSkeleton />;
  if (error || !rack) return <ErrorState message={error || 'Not found'} onRetry={load} />;

  return (
    <Screen>
      <ScrollView>
        <Muted>
          {rack.warehouse_code} | {rack.barcode_value}
        </Muted>
        <Button label="Open visual rack map" onPress={() => navigation.navigate('RackMap', { id })} />
        <Card>
          <Subtitle>Shelves / positions</Subtitle>
          {(rack.shelves || []).map((s: any) => (
            <Text key={s.id} style={{ marginBottom: 4 }}>
              Shelf {s.code}: {(s.positions || []).map((p: any) => `${p.code} (#${p.id})`).join(', ')}
            </Text>
          ))}
        </Card>
        <Card>
          <Subtitle>Inventory in rack</Subtitle>
          {inventory.length === 0 ? <Muted>Empty</Muted> : null}
          {inventory.map((a) => (
            <Pressable
              key={a.id}
              onPress={() =>
                navigation.navigate('AllocationDetail', {
                  allocationId: a.id,
                  batchId: a.batch ?? null,
                  unitId: a.unit ?? null,
                  quantity: a.quantity ?? null,
                  location: `${a.warehouse}/${a.rack}/${a.shelf}/${a.position_code}`,
                  warehouseCode: a.warehouse,
                  rackId: id,
                  rackCode: a.rack,
                  shelfCode: a.shelf,
                  positionCode: a.position_code,
                  positionId: a.position,
                })
              }
              style={{ marginBottom: 10, paddingVertical: 4 }}
            >
              <Text style={{ fontWeight: '700', color: colors.navy }}>
                {a.batch_code
                  ? `Batch ${a.batch_code}`
                  : a.unit_code
                    ? `Unit ${a.unit_code}`
                    : 'Item'}{' '}
                ({a.item_name})
              </Text>
              <Muted>
                {a.shelf}/{a.position_code} · qty {a.quantity} · tap for history
              </Muted>
            </Pressable>
          ))}
        </Card>
      </ScrollView>
    </Screen>
  );
}

export function AllocateScreen({ route }: any) {
  const params = route?.params || {};
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [batches, setBatches] = useState<any[]>([]);
  const [units, setUnits] = useState<any[]>([]);
  const [mode, setMode] = useState<'batch' | 'unit'>('batch');
  const [stockQ, setStockQ] = useState('');
  const debouncedStockQ = useDebouncedValue(stockQ, 160);
  const stockQRef = useRef(stockQ);
  stockQRef.current = stockQ;
  const [batchId, setBatchId] = useState<number | null>(null);
  const [unitId, setUnitId] = useState<number | null>(null);
  const [positionId, setPositionId] = useState<number | null>(params.positionId ?? null);
  const [positionLabel, setPositionLabel] = useState<string | null>(params.positionLabel ?? null);
  const [quantity, setQuantity] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const appliedParams = useRef('');

  useFocusEffect(
    useCallback(() => {
      const p = route?.params || {};
      const key = `${p.positionId ?? ''}|${p.positionLabel ?? ''}|${p.resetKey ?? ''}`;
      if (key !== appliedParams.current) {
        appliedParams.current = key;
        if (p.positionId != null || p.positionLabel) {
          setPositionId(p.positionId ?? null);
          setPositionLabel(p.positionLabel ?? null);
        } else {
          // Fresh entry (e.g. Warehouse → Allocate) must not keep a prior map cell.
          setPositionId(null);
          setPositionLabel(null);
        }
      }
      setMsg('');
      setError('');
    }, [route?.params?.positionId, route?.params?.positionLabel, route?.params?.resetKey])
  );

  const loadPickers = useCallback(async (opts?: { stockQ?: string }) => {
    const sq = opts?.stockQ ?? debouncedStockQ;
    setSearching(true);
    try {
      const [loc, inv] = await Promise.all([
        warehouseApi.locations(),
        inventoryApi.list({ q: sq.trim() || undefined }),
      ]);
      setLocations(loc.data || []);
      // Allocate only QA-passed stock that is still available to put away.
      setBatches(
        (inv.data.batches || []).filter(
          (b: any) => b.testing_status === 'PASSED' && Number(b.available_qty) > 0
        )
      );
      setUnits(
        (inv.data.units || []).filter(
          (u: any) => u.status === 'AVAILABLE' && u.testing_status === 'PASSED'
        )
      );
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setSearching(false);
    }
  }, [debouncedStockQ]);

  useEffect(() => {
    loadPickers();
  }, [loadPickers]);

  const selectedBatch = batches.find((b) => b.id === batchId);
  const selectedUnit = units.find((u) => u.id === unitId);
  const stockLabel =
    mode === 'batch'
      ? selectedBatch
        ? `Batch: ${selectedBatch.batch_code}`
        : ''
      : selectedUnit
        ? `Unit: ${selectedUnit.unit_code}`
        : '';
  const destLabel = positionId && positionLabel ? `Destination: ${positionLabel}` : '';

  return (
    <Screen>
      <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled>
        <Muted>Allocate in 3 steps: warehouse → rack number → row/column.</Muted>
        {positionLabel && positionId ? <Muted>Preselected from map: {positionLabel}</Muted> : null}

        <SelectionSummary lines={[stockLabel, destLabel]} />

        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
          <View style={{ flex: 1 }}>
            <Button
              label="Batch"
              variant={mode === 'batch' ? 'primary' : 'secondary'}
              onPress={() => {
                setMode('batch');
                setUnitId(null);
              }}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              label="Unit"
              variant={mode === 'unit' ? 'primary' : 'secondary'}
              onPress={() => {
                setMode('unit');
                setBatchId(null);
                setQuantity('');
              }}
            />
          </View>
        </View>

        <Card>
          <Subtitle>{mode === 'batch' ? 'Select batch' : 'Select unit'}</Subtitle>
          <SearchInput
            placeholder={mode === 'batch' ? 'Search batch / item...' : 'Search unit / item...'}
            value={stockQ}
            onChangeText={setStockQ}
            searching={searching}
            onClear={() => setStockQ('')}
          />
          <Muted>
            {mode === 'batch' ? `${batches.length} batches` : `${units.length} units`} · scroll inside box
          </Muted>
          {mode === 'batch' ? (
            <SelectList maxHeight={200} count={batches.length} emptyLabel="No batches found">
              {batches.slice(0, 50).map((b) => (
                <SelectRow
                  key={b.id}
                  label={b.batch_code}
                  subtitle={`Available ${b.available_qty}`}
                  selected={batchId === b.id}
                  onPress={() => setBatchId(b.id)}
                />
              ))}
            </SelectList>
          ) : (
            <SelectList maxHeight={200} count={units.length} emptyLabel="No units found">
              {units.slice(0, 50).map((u) => (
                <SelectRow
                  key={u.id}
                  label={u.unit_code}
                  subtitle={u.item_name || u.item?.name || 'Item'}
                  selected={unitId === u.id}
                  onPress={() => setUnitId(u.id)}
                />
              ))}
            </SelectList>
          )}
        </Card>

        <LocationCascadePicker
          title="Select destination"
          locations={locations}
          selectedId={positionId}
          onSelect={(loc) => {
            setPositionId(loc?.id ?? null);
            setPositionLabel(loc?.label ?? null);
          }}
        />

        {mode === 'batch' ? (
          <Input
            placeholder={
              selectedBatch ? `Quantity (required, max ${selectedBatch.available_qty})` : 'Quantity (required)'
            }
            value={quantity}
            onChangeText={setQuantity}
            keyboardType="numeric"
          />
        ) : (
          <Muted>Unit allocate moves quantity 1.</Muted>
        )}
        {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
        {msg ? <Text style={{ color: colors.success }}>{msg}</Text> : null}
        <Button
          label="Allocate"
          loading={loading}
          onPress={async () => {
            if ((!batchId && !unitId) || !positionId) {
              setError(
                mode === 'batch'
                  ? 'Select batch and finish warehouse → rack → cell'
                  : 'Select unit and finish warehouse → rack → cell'
              );
              return;
            }
            if (mode === 'batch') {
              const n = Number(quantity);
              if (!quantity.trim() || !Number.isFinite(n) || n <= 0) {
                setError('Enter the quantity to put away');
                return;
              }
              const max = Number(selectedBatch?.available_qty);
              if (Number.isFinite(max) && n > max) {
                setError(`Quantity cannot exceed available (${max})`);
                return;
              }
            }
            setLoading(true);
            try {
              const payload: any = {
                position_id: positionId,
                allocation_type: 'ACTUAL',
              };
              if (unitId) {
                payload.unit_id = unitId;
              } else {
                payload.batch_id = batchId;
                payload.quantity = Number(quantity);
              }
              const what = unitId ? `unit #${unitId}` : `batch ${selectedBatch?.batch_code ?? `#${batchId}`}`;
              const res = await postOrQueue({
                type: 'allocate',
                path: '/locations/allocate/',
                body: payload,
                label: `Put away ${what} to position #${positionId}`,
              });
              setMsg(
                res.queued
                  ? 'No connection. Saved on this phone and will sync automatically.'
                  : 'Allocated successfully'
              );
              setError('');
            } catch (e) {
              setError(getErrorMessage(e));
              setMsg('');
            } finally {
              setLoading(false);
            }
          }}
        />
      </ScrollView>
    </Screen>
  );
}

export function TransferScreen({ route }: any) {
  const [fromId, setFromId] = useState<number | null>(null);
  const [toId, setToId] = useState<number | null>(null);
  const [batchId, setBatchId] = useState<number | null>(null);
  const [unitId, setUnitId] = useState<number | null>(null);
  const [qty, setQty] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [batches, setBatches] = useState<any[]>([]);
  const [units, setUnits] = useState<any[]>([]);
  const [stockQ, setStockQ] = useState('');
  const debouncedStockQ = useDebouncedValue(stockQ, 160);
  const stockQRef = useRef(stockQ);
  stockQRef.current = stockQ;
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const appliedParams = useRef('');

  useFocusEffect(
    useCallback(() => {
      const p = route?.params || {};
      const key = `${p.fromPositionId ?? ''}|${p.toPositionId ?? ''}|${p.batchId ?? ''}|${p.unitId ?? ''}|${p.resetKey ?? ''}`;
      if (key === appliedParams.current) {
        setMsg('');
        setError('');
        return;
      }
      appliedParams.current = key;

      const hasPreset =
        p.fromPositionId != null ||
        p.toPositionId != null ||
        p.batchId != null ||
        p.unitId != null;

      if (hasPreset) {
        // Apply full snapshot so omitted fields clear (no leftover batch/unit from last trip).
        setFromId(p.fromPositionId ?? null);
        setToId(p.toPositionId ?? null);
        setBatchId(p.batchId ?? null);
        setUnitId(p.unitId ?? null);
        setQty(p.unitId != null ? '1' : '');
      } else {
        setFromId(null);
        setToId(null);
        setBatchId(null);
        setUnitId(null);
        setQty('');
      }
      setMsg('');
      setError('');
    }, [
      route?.params?.fromPositionId,
      route?.params?.toPositionId,
      route?.params?.batchId,
      route?.params?.unitId,
      route?.params?.resetKey,
    ])
  );

  const loadPickers = useCallback(async (opts?: { stockQ?: string }) => {
    const sq = opts?.stockQ ?? debouncedStockQ;
    setSearching(true);
    try {
      const [loc, inv] = await Promise.all([
        warehouseApi.locations(),
        inventoryApi.list({ q: sq.trim() || undefined }),
      ]);
      setLocations(loc.data || []);
      setBatches(inv.data.batches || []);
      setUnits(inv.data.units || []);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setSearching(false);
    }
  }, [debouncedStockQ]);

  useEffect(() => {
    loadPickers();
  }, [loadPickers]);

  const selectedBatch = batches.find((b) => b.id === batchId);
  const selectedUnit = units.find((u) => u.id === unitId);
  const mode: 'batch' | 'unit' | null = unitId ? 'unit' : batchId ? 'batch' : null;
  const fromLabel = locations.find((l) => l.id === fromId)?.label;
  const toLabel = locations.find((l) => l.id === toId)?.label;

  return (
    <Screen>
      <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled>
        <Muted>Move stock: pick From and To as warehouse → rack → row/column.</Muted>

        <SelectionSummary
          lines={[
            selectedBatch
              ? `Stock: ${selectedBatch.batch_code}`
              : selectedUnit
                ? `Stock: ${selectedUnit.unit_code}`
                : '',
            fromId ? `From: ${fromLabel || `#${fromId}`}` : '',
            toId ? `To: ${toLabel || `#${toId}`}` : '',
          ]}
        />

        <Card>
          <Subtitle>Stock to move</Subtitle>
          <SearchInput
            placeholder="Search batch / unit..."
            value={stockQ}
            onChangeText={setStockQ}
            searching={searching}
            onClear={() => setStockQ('')}
          />
          <Muted>Batches</Muted>
          <SelectList maxHeight={160} count={batches.length} emptyLabel="No batches found">
            {batches.slice(0, 40).map((b) => (
              <SelectRow
                key={`b-${b.id}`}
                label={b.batch_code}
                subtitle={`Avail ${b.available_qty}`}
                selected={batchId === b.id}
                onPress={() => {
                  setBatchId(b.id);
                  setUnitId(null);
                  setQty('');
                }}
              />
            ))}
          </SelectList>
          <Muted>Units</Muted>
          <SelectList maxHeight={160} count={units.length} emptyLabel="No units found">
            {units.slice(0, 40).map((u) => (
              <SelectRow
                key={`u-${u.id}`}
                label={u.unit_code}
                subtitle={u.item_name || u.item?.name || 'Item'}
                selected={unitId === u.id}
                onPress={() => {
                  setUnitId(u.id);
                  setBatchId(null);
                  setQty('1');
                }}
              />
            ))}
          </SelectList>
        </Card>

        <LocationCascadePicker
          title="From location"
          locations={locations}
          selectedId={fromId}
          onSelect={(loc) => setFromId(loc?.id ?? null)}
        />

        <LocationCascadePicker
          title="To location"
          locations={locations}
          selectedId={toId}
          onSelect={(loc) => setToId(loc?.id ?? null)}
        />

        {!mode ? (
          <Muted>Select a batch or unit above before setting quantity.</Muted>
        ) : mode === 'batch' ? (
          <>
            <Input
              placeholder={
                selectedBatch
                  ? `Qty at From cell (batch avail ${selectedBatch.available_qty})`
                  : 'Quantity'
              }
              value={qty}
              onChangeText={setQty}
              keyboardType="numeric"
            />
            <Muted>Quantity cannot exceed what is currently at the From cell.</Muted>
          </>
        ) : (
          <Muted>Unit transfers move quantity 1.</Muted>
        )}
        {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
        {msg ? <Text style={{ color: colors.success }}>{msg}</Text> : null}
        <Button
          label="Transfer"
          loading={loading}
          onPress={async () => {
            if ((!batchId && !unitId) || !fromId || !toId) {
              setError('Select stock and finish From / To (warehouse → rack → cell)');
              return;
            }
            if (batchId && unitId) {
              setError('Choose either a batch or a unit, not both');
              return;
            }
            if (batchId) {
              const n = Number(qty);
              if (!qty.trim() || !Number.isFinite(n) || n <= 0) {
                setError('Enter a valid transfer quantity');
                return;
              }
            }
            setLoading(true);
            try {
              const payload: any = {
                from_position_id: fromId,
                to_position_id: toId,
                reason: 'Mobile transfer',
              };
              if (unitId) {
                payload.unit_id = unitId;
              } else {
                payload.batch_id = batchId;
                payload.quantity = Number(qty);
              }
              const res = await postOrQueue({
                type: 'transfer',
                path: '/locations/transfer/',
                body: payload,
                label: `Move ${unitId ? `unit #${unitId}` : `batch #${batchId}`} from position #${fromId} to #${toId}`,
              });
              setMsg(
                res.queued
                  ? 'No connection. Saved on this phone and will sync automatically.'
                  : 'Transfer recorded'
              );
              setError('');
            } catch (e) {
              setError(getErrorMessage(e));
              setMsg('');
            } finally {
              setLoading(false);
            }
          }}
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stepChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  stepChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.primarySoft,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  stepChipText: {
    color: colors.navy,
    fontWeight: '700',
    fontSize: 13,
  },
  stepChipChange: {
    color: colors.primaryDark,
    fontWeight: '800',
    fontSize: 12,
  },
});
