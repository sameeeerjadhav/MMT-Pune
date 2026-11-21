import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { warehouseApi, inventoryApi } from '../api/endpoints';
import { getErrorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { RackIcon } from '../components/icons';
import {
  Badge,
  Button,
  Card,
  ErrorState,
  FormActions,
  InactiveDot,
  Input,
  LoadingState,
  ManageActionBar,
  Muted,
  Screen,
  SearchInput,
  Subtitle,
  TextAction,
} from '../components/ui';
import { useTabScrollPadding } from '../hooks/useTabScrollPadding';
import { colors } from '../theme/tokens';
import { canAccess } from '../utils/roles';

export function WarehouseListScreen({ navigation }: any) {
  const { user } = useAuth();
  const scrollPad = useTabScrollPadding(28);
  const canManage = canAccess(user?.role, 'manageMasterData');
  const canCreate = canAccess(user?.role, 'createRack');
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [racks, setRacks] = useState<any[]>([]);
  const [selectedWarehouse, setSelectedWarehouse] = useState<number | null>(null);
  const [rackQuery, setRackQuery] = useState('');
  const rackQueryRef = useRef(rackQuery);
  rackQueryRef.current = rackQuery;
  const selectedWhRef = useRef(selectedWarehouse);
  selectedWhRef.current = selectedWarehouse;
  const loadSeq = useRef(0);
  const [loading, setLoading] = useState(true);
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
    async (q?: string, warehouseId?: number | null) => {
      const seq = ++loadSeq.current;
      try {
        const params: any = {};
        if (canManage) params.include_inactive = '1';
        const query = (q ?? rackQueryRef.current).trim();
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
        if (seq === loadSeq.current) setLoading(false);
      }
    },
    [canManage]
  );

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const filteredRacks =
    selectedWarehouse && !rackQuery.trim()
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

  if (loading && !warehouses.length && !racks.length) return <LoadingState />;
  if (error && !racks.length && !warehouses.length) return <ErrorState message={error} onRetry={() => load()} />;

  const header = (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <RackIcon size={22} color={colors.primaryDark} />
        <Muted>Search racks, open maps, and manage stock placement.</Muted>
      </View>

      <SearchInput
        placeholder="Search racks..."
        value={rackQuery}
        onChangeText={setRackQuery}
        onSubmitEditing={() => load(rackQuery)}
        onClear={() => {
          setRackQuery('');
          load('');
        }}
      />
      <Button label="Search" variant="secondary" onPress={() => load(rackQuery)} />

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
                <InactiveDot active={active} size={9} />
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
          <Button label="Allocate" onPress={() => navigation.navigate('Allocate')} />
        </View>
        <View style={{ flex: 1 }}>
          <Button label="Transfer" variant="secondary" onPress={() => navigation.navigate('Transfer')} />
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
                  <InactiveDot active={active} size={9} />
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
  if (loading) return <LoadingState />;
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
            <Text key={a.id} style={{ marginBottom: 6 }}>
              {a.batch_code
                ? `Batch ${a.batch_code}`
                : a.unit_code
                  ? `Unit ${a.unit_code}`
                  : 'Item'}{' '}
              ({a.item_name}) @ {a.shelf}/{a.position_code} qty {a.quantity}
            </Text>
          ))}
        </Card>
      </ScrollView>
    </Screen>
  );
}

export function AllocateScreen({ route }: any) {
  const params = route?.params || {};
  const [locations, setLocations] = useState<any[]>([]);
  const [batches, setBatches] = useState<any[]>([]);
  const [units, setUnits] = useState<any[]>([]);
  const [mode, setMode] = useState<'batch' | 'unit'>('batch');
  const [stockQ, setStockQ] = useState('');
  const [locQ, setLocQ] = useState('');
  const stockQRef = useRef(stockQ);
  stockQRef.current = stockQ;
  const locQRef = useRef(locQ);
  locQRef.current = locQ;
  const [batchId, setBatchId] = useState<number | null>(null);
  const [unitId, setUnitId] = useState<number | null>(null);
  const [positionId, setPositionId] = useState<number | null>(params.positionId ?? null);
  const [positionLabel, setPositionLabel] = useState<string | null>(params.positionLabel ?? null);
  const [quantity, setQuantity] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const appliedParams = useRef('');

  useFocusEffect(
    useCallback(() => {
      const p = route?.params || {};
      const key = `${p.positionId ?? ''}|${p.positionLabel ?? ''}`;
      if (key !== appliedParams.current && (p.positionId != null || p.positionLabel)) {
        appliedParams.current = key;
        if (p.positionId != null) setPositionId(p.positionId);
        if (p.positionLabel) setPositionLabel(p.positionLabel);
      }
      setMsg('');
      setError('');
    }, [route?.params?.positionId, route?.params?.positionLabel])
  );

  const loadPickers = useCallback(async (opts?: { stockQ?: string; locQ?: string }) => {
    const sq = opts?.stockQ ?? stockQRef.current;
    const lq = opts?.locQ ?? locQRef.current;
    try {
      const [loc, inv] = await Promise.all([
        warehouseApi.locations({ q: lq || undefined }),
        inventoryApi.list({ q: sq || undefined }),
      ]);
      setLocations(loc.data);
      setBatches(inv.data.batches || []);
      setUnits(inv.data.units || []);
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }, []);

  useEffect(() => {
    loadPickers();
  }, [loadPickers]);

  const selectedBatch = batches.find((b) => b.id === batchId);

  return (
    <Screen>
      <ScrollView>
        <Muted>Assign stock to a rack position (actual location).</Muted>
        {positionLabel && positionId ? <Muted>Preselected from map: {positionLabel}</Muted> : null}

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
            onSubmitEditing={() => loadPickers()}
            onClear={() => {
              setStockQ('');
              loadPickers({ stockQ: '' });
            }}
          />
          <Button label="Search stock" variant="secondary" onPress={() => loadPickers()} />
          {mode === 'batch'
            ? batches.slice(0, 30).map((b) => (
                <Pressable key={b.id} onPress={() => setBatchId(b.id)}>
                  <Text
                    style={{
                      paddingVertical: 6,
                      fontWeight: batchId === b.id ? '700' : '400',
                      color: batchId === b.id ? colors.primary : colors.text,
                    }}
                  >
                    {b.batch_code} — avail {b.available_qty}
                  </Text>
                </Pressable>
              ))
            : units.slice(0, 30).map((u) => (
                <Pressable key={u.id} onPress={() => setUnitId(u.id)}>
                  <Text
                    style={{
                      paddingVertical: 6,
                      fontWeight: unitId === u.id ? '700' : '400',
                      color: unitId === u.id ? colors.primary : colors.text,
                    }}
                  >
                    {u.unit_code} — {u.item_name || u.item?.name || 'Item'}
                  </Text>
                </Pressable>
              ))}
        </Card>

        <Card>
          <Subtitle>Select destination</Subtitle>
          <SearchInput
            placeholder="Search location..."
            value={locQ}
            onChangeText={setLocQ}
            onSubmitEditing={() => loadPickers()}
            onClear={() => {
              setLocQ('');
              loadPickers({ locQ: '' });
            }}
          />
          <Button label="Search locations" variant="secondary" onPress={() => loadPickers()} />
          {locations.slice(0, 40).map((l) => (
            <Pressable
              key={l.id}
              onPress={() => {
                setPositionId(l.id);
                setPositionLabel(l.label);
              }}
            >
              <Text
                style={{
                  paddingVertical: 6,
                  fontWeight: positionId === l.id ? '700' : '400',
                  color: positionId === l.id ? colors.primary : colors.text,
                }}
              >
                {l.label}
              </Text>
            </Pressable>
          ))}
        </Card>

        {mode === 'batch' ? (
          <Input
            placeholder={selectedBatch ? `Quantity (max ${selectedBatch.available_qty})` : 'Quantity (optional)'}
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
              setError(mode === 'batch' ? 'Select batch and location' : 'Select unit and location');
              return;
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
                if (quantity) payload.quantity = Number(quantity);
              }
              await warehouseApi.allocate(payload);
              setMsg('Allocated successfully');
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
  const [qty, setQty] = useState('10');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [locations, setLocations] = useState<any[]>([]);
  const [batches, setBatches] = useState<any[]>([]);
  const [units, setUnits] = useState<any[]>([]);
  const [stockQ, setStockQ] = useState('');
  const [locQ, setLocQ] = useState('');
  const stockQRef = useRef(stockQ);
  stockQRef.current = stockQ;
  const locQRef = useRef(locQ);
  locQRef.current = locQ;
  const [loading, setLoading] = useState(false);
  const appliedParams = useRef('');

  useFocusEffect(
    useCallback(() => {
      const p = route?.params || {};
      const key = `${p.fromPositionId ?? ''}|${p.toPositionId ?? ''}|${p.batchId ?? ''}|${p.unitId ?? ''}`;
      const hasUseful =
        p.fromPositionId != null || p.toPositionId != null || p.batchId != null || p.unitId != null;
      if (hasUseful && key !== appliedParams.current) {
        appliedParams.current = key;
        if (p.fromPositionId != null) setFromId(p.fromPositionId);
        if (p.toPositionId != null) setToId(p.toPositionId);
        if (p.batchId != null) {
          setBatchId(p.batchId);
          setUnitId(null);
        }
        if (p.unitId != null) {
          setUnitId(p.unitId);
          setBatchId(null);
          setQty('1');
        }
      }
      setMsg('');
      setError('');
    }, [
      route?.params?.fromPositionId,
      route?.params?.toPositionId,
      route?.params?.batchId,
      route?.params?.unitId,
    ])
  );

  const loadPickers = useCallback(async (opts?: { stockQ?: string; locQ?: string }) => {
    const sq = opts?.stockQ ?? stockQRef.current;
    const lq = opts?.locQ ?? locQRef.current;
    try {
      const [loc, inv] = await Promise.all([
        warehouseApi.locations({ q: lq || undefined }),
        inventoryApi.list({ q: sq || undefined }),
      ]);
      setLocations(loc.data);
      setBatches(inv.data.batches || []);
      setUnits(inv.data.units || []);
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }, []);

  useEffect(() => {
    loadPickers();
  }, [loadPickers]);

  const mode: 'batch' | 'unit' = unitId ? 'unit' : 'batch';

  return (
    <Screen>
      <ScrollView>
        <Muted>Move stock between positions. Source must have active stock.</Muted>
        {fromId ? <Muted>From position preselected from rack map (#{fromId}).</Muted> : null}
        {toId ? <Muted>To position preselected from rack map (#{toId}).</Muted> : null}

        <Card>
          <Subtitle>Stock to move</Subtitle>
          <SearchInput
            placeholder="Search batch / unit..."
            value={stockQ}
            onChangeText={setStockQ}
            onSubmitEditing={() => loadPickers()}
            onClear={() => {
              setStockQ('');
              loadPickers({ stockQ: '' });
            }}
          />
          <Button label="Search stock" variant="secondary" onPress={() => loadPickers()} />
          <Text style={{ fontWeight: '700', marginTop: 8, marginBottom: 4 }}>Batches</Text>
          {batches.slice(0, 20).map((b) => (
            <Pressable
              key={`b-${b.id}`}
              onPress={() => {
                setBatchId(b.id);
                setUnitId(null);
              }}
            >
              <Text
                style={{
                  paddingVertical: 6,
                  fontWeight: batchId === b.id ? '700' : '400',
                  color: batchId === b.id ? colors.primary : colors.text,
                }}
              >
                {b.batch_code} (id {b.id})
              </Text>
            </Pressable>
          ))}
          <Text style={{ fontWeight: '700', marginTop: 10, marginBottom: 4 }}>Units</Text>
          {units.slice(0, 20).map((u) => (
            <Pressable
              key={`u-${u.id}`}
              onPress={() => {
                setUnitId(u.id);
                setBatchId(null);
                setQty('1');
              }}
            >
              <Text
                style={{
                  paddingVertical: 6,
                  fontWeight: unitId === u.id ? '700' : '400',
                  color: unitId === u.id ? colors.primary : colors.text,
                }}
              >
                {u.unit_code} (id {u.id})
              </Text>
            </Pressable>
          ))}
          {!batches.length && !units.length ? <Muted>No inventory loaded.</Muted> : null}
        </Card>

        <Card>
          <Subtitle>From / To location</Subtitle>
          <SearchInput
            placeholder="Search location..."
            value={locQ}
            onChangeText={setLocQ}
            onSubmitEditing={() => loadPickers()}
            onClear={() => {
              setLocQ('');
              loadPickers({ locQ: '' });
            }}
          />
          <Button label="Search locations" variant="secondary" onPress={() => loadPickers()} />
          {locations.slice(0, 40).map((l) => (
            <View
              key={l.id}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                marginBottom: 8,
                flexWrap: 'wrap',
              }}
            >
              <Text style={{ flex: 1, color: colors.text }}>
                #{l.id}: {l.label}
              </Text>
              <TextAction label="From" onPress={() => setFromId(l.id)} />
              <Text style={{ color: colors.border }}>·</Text>
              <TextAction label="To" onPress={() => setToId(l.id)} tone="muted" />
            </View>
          ))}
          <Muted>
            From: {fromId ?? '—'} · To: {toId ?? '—'}
          </Muted>
        </Card>

        {mode === 'batch' ? (
          <Input placeholder="Quantity" value={qty} onChangeText={setQty} keyboardType="numeric" />
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
              setError('Select stock, from, and to locations');
              return;
            }
            if (batchId && unitId) {
              setError('Choose either a batch or a unit, not both');
              return;
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
              await warehouseApi.transfer(payload);
              setMsg('Transfer recorded');
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
