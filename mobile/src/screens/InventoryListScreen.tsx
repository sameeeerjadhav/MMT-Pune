import React, { useCallback, useRef, useState } from 'react';
import { FlatList, Image, Pressable, Text, View } from 'react-native';
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
} from '../components/ui';
import { EmptyBoxIcon } from '../components/icons';
import { useTabScrollPadding } from '../hooks/useTabScrollPadding';
import { colors } from '../theme/tokens';

export default function InventoryListScreen() {
  const navigation = useNavigation<any>();
  const scrollPad = useTabScrollPadding(28);
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
        contentContainerStyle={{ paddingBottom: scrollPad }}
        data={rows}
        keyExtractor={(item) => `${item.kind}-${item.id}`}
        ListHeaderComponent={<SectionLabel>{rows.length} results</SectionLabel>}
        ListEmptyComponent={
          <Card>
            <View style={{ alignItems: 'center', paddingVertical: 12 }}>
              <EmptyBoxIcon size={64} />
              <Muted>No inventory matched your search. Try BATCH-001 or clear the filter.</Muted>
            </View>
          </Card>
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() =>
              navigation.navigate(item.kind === 'BATCH' ? 'BatchDetail' : 'UnitDetail', { id: item.id })
            }
          >
            <Card>
              <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
                {item.item?.image_url ? (
                  <Image
                    source={{ uri: item.item.image_url }}
                    style={{ width: 56, height: 56, borderRadius: 12, backgroundColor: colors.surfaceMuted }}
                  />
                ) : (
                  <View
                    style={{
                      width: 56,
                      height: 56,
                      borderRadius: 12,
                      backgroundColor: colors.primarySoft,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <EmptyBoxIcon size={28} />
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ fontWeight: '800', color: colors.navy, fontSize: 16, flex: 1 }}>
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
                </View>
              </View>
            </Card>
          </Pressable>
        )}
      />
    </Screen>
  );
}
