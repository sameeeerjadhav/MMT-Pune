import React, { useCallback, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { inventoryApi } from '../api/endpoints';
import { getErrorMessage } from '../api/client';
import { Badge, Card, ErrorState, Input, LoadingState, Muted, Screen, Title } from '../components/ui';

export default function InventoryListScreen() {
  const navigation = useNavigation<any>();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async (query = q) => {
    setError('');
    try {
      const { data } = await inventoryApi.list({ q: query || undefined });
      const batches = (data.batches || []).map((b: any) => ({ kind: 'BATCH', ...b }));
      const units = (data.units || []).map((u: any) => ({ kind: 'UNIT', ...u }));
      setRows([...batches, ...units]);
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
  if (error) return <ErrorState message={error} onRetry={() => load()} />;

  return (
    <Screen>
      <Title>Inventory</Title>
      <Input
        placeholder="Search item, batch, barcode..."
        value={q}
        onChangeText={setQ}
        onSubmitEditing={() => load(q)}
      />
      <FlatList
        data={rows}
        keyExtractor={(item) => `${item.kind}-${item.id}`}
        renderItem={({ item }) => (
          <Pressable
            onPress={() =>
              navigation.navigate(
                item.kind === 'BATCH' ? 'BatchDetail' : 'UnitDetail',
                { id: item.id }
              )
            }
          >
            <Card>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontWeight: '700' }}>
                  {item.kind === 'BATCH' ? item.batch_code : item.unit_code}
                </Text>
                <Badge label={item.kind} tone={item.kind === 'BATCH' ? 'primary' : 'success'} />
              </View>
              <Text>{item.item?.name}</Text>
              <Muted>
                {item.kind === 'BATCH'
                  ? `Available ${item.available_qty} | Barcode ${item.barcode_value}`
                  : `Status ${item.status} | Barcode ${item.barcode_value}`}
              </Muted>
            </Card>
          </Pressable>
        )}
      />
    </Screen>
  );
}
