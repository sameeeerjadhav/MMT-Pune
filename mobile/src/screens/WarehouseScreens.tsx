import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, ScrollView, Text } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { warehouseApi, inventoryApi } from '../api/endpoints';
import { getErrorMessage } from '../api/client';
import { Button, Card, ErrorState, Input, LoadingState, Muted, Screen, Subtitle, Title } from '../components/ui';
import { colors } from '../theme/tokens';

export function WarehouseListScreen({ navigation }: any) {
  const [racks, setRacks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const { data } = await warehouseApi.racks();
      setRacks(data);
      setError('');
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load();
    }, [])
  );

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  return (
    <Screen>
      <Title>Racks</Title>
      <Button label="Allocate stock" onPress={() => navigation.navigate('Allocate')} />
      <Button label="Transfer stock" variant="secondary" onPress={() => navigation.navigate('Transfer')} />
      <FlatList
        data={racks}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => (
          <Pressable onPress={() => navigation.navigate('RackDetail', { id: item.id })}>
            <Card>
              <Text style={{ fontWeight: '700' }}>{item.code} — {item.name}</Text>
              <Muted>
                {item.warehouse_code} | Barcode {item.barcode_value}
              </Muted>
            </Card>
          </Pressable>
        )}
      />
    </Screen>
  );
}

export function RackDetailScreen({ route }: any) {
  const { id } = route.params;
  const [rack, setRack] = useState<any>(null);
  const [inventory, setInventory] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [r, inv] = await Promise.all([warehouseApi.rack(id), warehouseApi.rackInventory(id)]);
        setRack(r.data);
        setInventory(inv.data);
      } catch (e) {
        setError(getErrorMessage(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  if (loading) return <LoadingState />;
  if (error || !rack) return <ErrorState message={error || 'Not found'} />;

  return (
    <Screen>
      <ScrollView>
        <Title>{rack.code}</Title>
        <Muted>
          {rack.warehouse_code} | {rack.barcode_value}
        </Muted>
        <Card>
          <Subtitle>Shelves / positions</Subtitle>
          {(rack.shelves || []).map((s: any) => (
            <Text key={s.id}>
              Shelf {s.code}: {(s.positions || []).map((p: any) => p.code).join(', ')}
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

export function AllocateScreen() {
  const [locations, setLocations] = useState<any[]>([]);
  const [batches, setBatches] = useState<any[]>([]);
  const [batchId, setBatchId] = useState('');
  const [positionId, setPositionId] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      const [loc, inv] = await Promise.all([warehouseApi.locations(), inventoryApi.list({ type: 'BULK' })]);
      setLocations(loc.data);
      setBatches(inv.data.batches || []);
    })();
  }, []);

  return (
    <Screen>
      <ScrollView>
        <Title>Allocate</Title>
        <Muted>Assign batch to a rack position (actual location).</Muted>
        <Input placeholder="Batch ID" value={batchId} onChangeText={setBatchId} keyboardType="numeric" />
        <Input placeholder="Position ID" value={positionId} onChangeText={setPositionId} keyboardType="numeric" />
        <Card>
          <Subtitle>Batches</Subtitle>
          {batches.slice(0, 8).map((b) => (
            <Text key={b.id} onPress={() => setBatchId(String(b.id))}>
              {b.id}: {b.batch_code}
            </Text>
          ))}
        </Card>
        <Card>
          <Subtitle>Locations</Subtitle>
          {locations.slice(0, 12).map((l) => (
            <Text key={l.id} onPress={() => setPositionId(String(l.id))}>
              {l.id}: {l.label}
            </Text>
          ))}
        </Card>
        {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
        {msg ? <Text style={{ color: colors.success }}>{msg}</Text> : null}
        <Button
          label="Allocate"
          onPress={async () => {
            try {
              await warehouseApi.allocate({
                batch_id: Number(batchId),
                position_id: Number(positionId),
                allocation_type: 'ACTUAL',
              });
              setMsg('Allocated successfully');
              setError('');
            } catch (e) {
              setError(getErrorMessage(e));
            }
          }}
        />
      </ScrollView>
    </Screen>
  );
}

export function TransferScreen() {
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [batchId, setBatchId] = useState('');
  const [qty, setQty] = useState('10');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [locations, setLocations] = useState<any[]>([]);

  useEffect(() => {
    warehouseApi.locations().then((r) => setLocations(r.data));
  }, []);

  return (
    <Screen>
      <ScrollView>
        <Title>Rack transfer</Title>
        <Input placeholder="Batch ID" value={batchId} onChangeText={setBatchId} keyboardType="numeric" />
        <Input placeholder="From position ID" value={fromId} onChangeText={setFromId} keyboardType="numeric" />
        <Input placeholder="To position ID" value={toId} onChangeText={setToId} keyboardType="numeric" />
        <Input placeholder="Quantity" value={qty} onChangeText={setQty} keyboardType="numeric" />
        <Card>
          {locations.slice(0, 15).map((l) => (
            <Text key={l.id}>
              {l.id}: {l.label}
            </Text>
          ))}
        </Card>
        {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
        {msg ? <Text style={{ color: colors.success }}>{msg}</Text> : null}
        <Button
          label="Transfer"
          onPress={async () => {
            try {
              await warehouseApi.transfer({
                batch_id: Number(batchId),
                from_position_id: Number(fromId),
                to_position_id: Number(toId),
                quantity: Number(qty),
                reason: 'Mobile transfer',
              });
              setMsg('Transfer recorded');
              setError('');
            } catch (e) {
              setError(getErrorMessage(e));
            }
          }}
        />
      </ScrollView>
    </Screen>
  );
}
