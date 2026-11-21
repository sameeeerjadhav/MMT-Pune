import React, { useCallback, useState } from 'react';
import { FlatList, Pressable, ScrollView, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { warehouseApi, inventoryApi } from '../api/endpoints';
import { getErrorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { RackIcon } from '../components/icons';
import { Button, Card, ErrorState, Input, LoadingState, Muted, Screen, Subtitle } from '../components/ui';
import { useTabScrollPadding } from '../hooks/useTabScrollPadding';
import { colors } from '../theme/tokens';
import { canAccess } from '../utils/roles';

export function WarehouseListScreen({ navigation }: any) {
  const { user } = useAuth();
  const scrollPad = useTabScrollPadding(28);
  const canCreate = canAccess(user?.role, 'createRack');
  const canEditFloor = canAccess(user?.role, 'editFloorLayout');
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [floors, setFloors] = useState<any[]>([]);
  const [racks, setRacks] = useState<any[]>([]);
  const [selectedWarehouse, setSelectedWarehouse] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreateRack, setShowCreateRack] = useState(false);
  const [showCreateFloor, setShowCreateFloor] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [floorCode, setFloorCode] = useState('');
  const [floorName, setFloorName] = useState('');
  const [floorRows, setFloorRows] = useState('3');
  const [floorCols, setFloorCols] = useState('4');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const [wh, floorRes, rackRes] = await Promise.all([
        warehouseApi.warehouses(),
        warehouseApi.floors(),
        warehouseApi.racks(),
      ]);
      setWarehouses(wh.data);
      setFloors(floorRes.data);
      setRacks(rackRes.data);
      setSelectedWarehouse((prev) => prev ?? (wh.data[0]?.id ?? null));
      setError('');
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const filteredFloors = selectedWarehouse
    ? floors.filter((f) => f.warehouse === selectedWarehouse || f.warehouse_id === selectedWarehouse)
    : floors;

  const filteredRacks = selectedWarehouse
    ? racks.filter((r) => r.warehouse === selectedWarehouse || r.warehouse_id === selectedWarehouse)
    : racks;

  const createRack = async () => {
    if (!selectedWarehouse || !newCode.trim()) {
      setError('Select a warehouse and enter a rack code');
      return;
    }
    setCreating(true);
    setError('');
    try {
      await warehouseApi.createRack({
        warehouse: selectedWarehouse,
        code: newCode.trim().toUpperCase(),
        name: newName.trim() || newCode.trim().toUpperCase(),
      });
      setNewCode('');
      setNewName('');
      setShowCreateRack(false);
      await load();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setCreating(false);
    }
  };

  const createFloor = async () => {
    if (!selectedWarehouse || !floorCode.trim()) {
      setError('Select a warehouse and enter a floor code');
      return;
    }
    const rows = parseInt(floorRows, 10);
    const cols = parseInt(floorCols, 10);
    if (!rows || !cols) {
      setError('Enter valid row and column counts');
      return;
    }
    setCreating(true);
    setError('');
    try {
      await warehouseApi.createFloor({
        warehouse_id: selectedWarehouse,
        code: floorCode.trim().toUpperCase(),
        name: floorName.trim() || floorCode.trim().toUpperCase(),
        row_count: rows,
        column_count: cols,
      });
      setFloorCode('');
      setFloorName('');
      setShowCreateFloor(false);
      await load();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setCreating(false);
    }
  };

  if (loading && !warehouses.length && !floors.length) return <LoadingState />;
  if (error && !floors.length && !warehouses.length) return <ErrorState message={error} onRetry={load} />;

  const roleHint =
    user?.role === 'ADMIN'
      ? 'Admin: create floors, set rows × columns, place large racks, then manage stock.'
      : user?.role === 'SUPERVISOR'
        ? 'Supervisor: set floor layouts and place racks; guide allocate / transfer on the floor.'
        : 'Employee: open a floor map to find which big rack holds stock, then allocate or transfer.';

  const header = (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <RackIcon size={22} color={colors.primaryDark} />
        <Muted>{roleHint}</Muted>
      </View>

      <Card>
        <Subtitle>Warehouse</Subtitle>
        {warehouses.map((w) => (
          <Pressable key={w.id} onPress={() => setSelectedWarehouse(w.id)}>
            <Text
              style={{
                paddingVertical: 8,
                fontWeight: selectedWarehouse === w.id ? '700' : '400',
                color: selectedWarehouse === w.id ? colors.primary : colors.text,
              }}
            >
              {w.code} — {w.name}
            </Text>
          </Pressable>
        ))}
      </Card>

      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Button
            label="Allocate"
            onPress={() => navigation.navigate('Allocate', { positionId: null, positionLabel: null })}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            label="Transfer"
            variant="secondary"
            onPress={() =>
              navigation.navigate('Transfer', {
                fromPositionId: null,
                toPositionId: null,
                batchId: null,
                unitId: null,
              })
            }
          />
        </View>
      </View>

      {canEditFloor ? (
        <Button
          label={showCreateFloor ? 'Cancel new floor' : 'Create floor'}
          variant="ghost"
          onPress={() => {
            setShowCreateFloor((v) => !v);
            setShowCreateRack(false);
          }}
        />
      ) : null}

      {showCreateFloor && canEditFloor ? (
        <Card>
          <Subtitle>New floor</Subtitle>
          <Input
            placeholder="Floor code (e.g. G or L1)"
            value={floorCode}
            onChangeText={setFloorCode}
            autoCapitalize="characters"
          />
          <Input placeholder="Floor name" value={floorName} onChangeText={setFloorName} />
          <Input placeholder="Rows of big racks" value={floorRows} onChangeText={setFloorRows} keyboardType="number-pad" />
          <Input
            placeholder="Columns of big racks"
            value={floorCols}
            onChangeText={setFloorCols}
            keyboardType="number-pad"
          />
          <Button label="Save floor" onPress={createFloor} loading={creating} />
        </Card>
      ) : null}

      {canCreate ? (
        <Button
          label={showCreateRack ? 'Cancel new rack' : 'Create rack'}
          variant="ghost"
          onPress={() => {
            setShowCreateRack((v) => !v);
            setShowCreateFloor(false);
          }}
        />
      ) : (
        <Muted>Floor layout and rack placement are managed by supervisors and admins.</Muted>
      )}

      {showCreateRack && canCreate ? (
        <Card>
          <Subtitle>New large rack</Subtitle>
          <Input
            placeholder="Rack code (e.g. R-11)"
            value={newCode}
            onChangeText={setNewCode}
            autoCapitalize="characters"
          />
          <Input placeholder="Rack name" value={newName} onChangeText={setNewName} />
          <Button label="Save rack" onPress={createRack} loading={creating} />
        </Card>
      ) : null}

      {error ? <Text style={{ color: colors.danger, marginBottom: 8 }}>{error}</Text> : null}
      <Subtitle>Floors ({filteredFloors.length})</Subtitle>
      <Muted>Open a floor to see the big rack grid for that level.</Muted>
    </View>
  );

  return (
    <Screen>
      <FlatList
        style={{ flex: 1 }}
        data={filteredFloors}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ paddingBottom: scrollPad }}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <Card>
            <Muted>
              {canEditFloor
                ? 'No floors yet. Create one and set how many rack rows and columns it has.'
                : 'No floors configured yet. Ask an admin or supervisor to set them up.'}
            </Muted>
          </Card>
        }
        renderItem={({ item }) => (
          <Pressable onPress={() => navigation.navigate('FloorMap', { id: item.id })}>
            <Card>
              <Text style={{ fontWeight: '700' }}>
                {item.code} — {item.name}
              </Text>
              <Muted>
                Level {item.level} · Grid {item.row_count}×{item.column_count} · {item.warehouse_code}
              </Muted>
              <Muted>Tap to open floor rack visualization</Muted>
            </Card>
          </Pressable>
        )}
        ListFooterComponent={
          <View style={{ marginTop: 16 }}>
            <Subtitle>All racks ({filteredRacks.length})</Subtitle>
            <Muted>Shortcut into a rack’s shelf × position map.</Muted>
            {filteredRacks.map((item) => (
              <Pressable key={item.id} onPress={() => navigation.navigate('RackMap', { id: item.id })}>
                <Card>
                  <Text style={{ fontWeight: '700' }}>
                    {item.code} — {item.name}
                  </Text>
                  <Muted>
                    {item.warehouse_code}
                    {item.floor_code ? ` · Floor ${item.floor_code}` : ''}
                    {item.row_index && item.column_index
                      ? ` · Bay R${item.row_index}-C${item.column_index}`
                      : ' · Not on floor grid'}
                  </Muted>
                </Card>
              </Pressable>
            ))}
          </View>
        }
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
  const [batchId, setBatchId] = useState<number | null>(null);
  const [positionId, setPositionId] = useState<number | null>(params.positionId ?? null);
  const [positionLabel, setPositionLabel] = useState<string | null>(params.positionLabel ?? null);
  const [quantity, setQuantity] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Always sync from route params on focus so re-entry clears stale presets.
  useFocusEffect(
    useCallback(() => {
      const p = route?.params || {};
      setPositionId(p.positionId ?? null);
      setPositionLabel(p.positionLabel ?? null);
      setMsg('');
      setError('');
    }, [route?.params?.positionId, route?.params?.positionLabel])
  );

  useEffect(() => {
    (async () => {
      const [loc, inv] = await Promise.all([warehouseApi.locations(), inventoryApi.list({ type: 'BULK' })]);
      setLocations(loc.data);
      setBatches(inv.data.batches || []);
    })();
  }, []);

  const selectedBatch = batches.find((b) => b.id === batchId);

  return (
    <Screen>
      <ScrollView>
        <Muted>Assign a batch to a rack position (actual location).</Muted>
        {positionLabel && positionId ? <Muted>Preselected from map: {positionLabel}</Muted> : null}

        <Card>
          <Subtitle>Select batch</Subtitle>
          {batches.slice(0, 12).map((b) => (
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
          ))}
        </Card>

        <Card>
          <Subtitle>Select destination</Subtitle>
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

        <Input
          placeholder={selectedBatch ? `Quantity (max ${selectedBatch.available_qty})` : 'Quantity (optional)'}
          value={quantity}
          onChangeText={setQuantity}
          keyboardType="numeric"
        />
        {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
        {msg ? <Text style={{ color: colors.success }}>{msg}</Text> : null}
        <Button
          label="Allocate"
          loading={loading}
          onPress={async () => {
            if (!batchId || !positionId) {
              setError('Select batch and location');
              return;
            }
            setLoading(true);
            try {
              const payload: any = {
                batch_id: batchId,
                position_id: positionId,
                allocation_type: 'ACTUAL',
              };
              if (quantity) payload.quantity = Number(quantity);
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
  const [loading, setLoading] = useState(false);

  useFocusEffect(
    useCallback(() => {
      const p = route?.params || {};
      setFromId(p.fromPositionId ?? null);
      setToId(p.toPositionId ?? null);
      setBatchId(p.batchId ?? null);
      setUnitId(p.unitId ?? null);
      if (p.unitId) setQty('1');
      setMsg('');
      setError('');
    }, [
      route?.params?.fromPositionId,
      route?.params?.toPositionId,
      route?.params?.batchId,
      route?.params?.unitId,
    ])
  );

  useEffect(() => {
    (async () => {
      const [loc, inv] = await Promise.all([warehouseApi.locations(), inventoryApi.list()]);
      setLocations(loc.data);
      setBatches(inv.data.batches || []);
      setUnits(inv.data.units || []);
    })();
  }, []);

  const mode: 'batch' | 'unit' = unitId ? 'unit' : 'batch';

  return (
    <Screen>
      <ScrollView>
        <Muted>Move stock between positions. Source must have active stock.</Muted>
        {fromId ? <Muted>From position preselected from rack map (#{fromId}).</Muted> : null}
        {toId ? <Muted>To position preselected from rack map (#{toId}).</Muted> : null}

        <Card>
          <Subtitle>Stock to move</Subtitle>
          <Muted>Pick a batch or a serialized unit (exactly one).</Muted>
          <Text style={{ fontWeight: '700', marginTop: 8, marginBottom: 4 }}>Batches</Text>
          {batches.slice(0, 12).map((b) => (
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
          {units.slice(0, 12).map((u) => (
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
          {locations.slice(0, 40).map((l) => (
            <Text key={l.id} style={{ marginBottom: 4 }}>
              #{l.id}: {l.label}{' '}
              <Text style={{ color: colors.primary }} onPress={() => setFromId(l.id)}>
                From
              </Text>
              {' · '}
              <Text style={{ color: colors.success }} onPress={() => setToId(l.id)}>
                To
              </Text>
            </Text>
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
