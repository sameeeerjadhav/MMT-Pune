import React, { useCallback, useRef, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { inventoryApi } from '../api/endpoints';
import { getErrorMessage } from '../api/client';
import {
  Badge,
  Button,
  Card,
  ErrorState,
  Input,
  LoadingState,
  Muted,
  Screen,
  SectionLabel,
  Title,
} from '../components/ui';
import { colors } from '../theme/tokens';

export default function InventoryListScreen() {
  const navigation = useNavigation<any>();
  const [q, setQ] = useState('');
  const qRef = useRef(q);
  qRef.current = q;
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (query?: string, soft = false) => {
    const qVal = query ?? qRef.current;
    setError('');
    if (soft) setRefreshing(true);
    else setLoading(true);
    try {
      const { data } = await inventoryApi.list({ q: qVal || undefined });
      const batches = (data.batches || []).map((b: any) => ({ kind: 'BATCH', ...b }));
      const units = (data.units || []).map((u: any) => ({ kind: 'UNIT', ...u }));
      setRows([...batches, ...units]);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (loading && !rows.length) return <LoadingState />;
  if (error && !rows.length) return <ErrorState message={error} onRetry={() => load()} />;

  return (
    <Screen>
      <Title>Inventory</Title>
      <Muted>Search live batches and units from PostgreSQL.</Muted>
      <Input
        placeholder="Search item, batch, barcode..."
        value={q}
        onChangeText={setQ}
        onSubmitEditing={() => load(q, true)}
        returnKeyType="search"
      />
      <Button label={refreshing ? 'Searching…' : 'Search'} onPress={() => load(q, true)} loading={refreshing} />
      {error ? <Text style={{ color: colors.danger, marginBottom: 8 }}>{error}</Text> : null}

      <FlatList
        style={{ flex: 1 }}
        data={rows}
        keyExtractor={(item) => `${item.kind}-${item.id}`}
        ListHeaderComponent={<SectionLabel>{rows.length} results</SectionLabel>}
        ListEmptyComponent={
          <Card>
            <Muted>No inventory matched your search. Try BATCH-001 or clear the filter.</Muted>
          </Card>
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() =>
              navigation.navigate(item.kind === 'BATCH' ? 'BatchDetail' : 'UnitDetail', { id: item.id })
            }
          >
            <Card>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ fontWeight: '800', color: colors.navy, fontSize: 16 }}>
                  {item.kind === 'BATCH' ? item.batch_code : item.unit_code}
                </Text>
                <Badge label={item.kind} tone={item.kind === 'BATCH' ? 'primary' : 'success'} />
              </View>
              <Text style={{ color: colors.text, marginTop: 4 }}>{item.item?.name}</Text>
              <Muted>
                {item.kind === 'BATCH'
                  ? `Available ${item.available_qty} · ${item.barcode_value}`
                  : `Status ${item.status} · ${item.barcode_value}`}
              </Muted>
            </Card>
          </Pressable>
        )}
      />
    </Screen>
  );
}
