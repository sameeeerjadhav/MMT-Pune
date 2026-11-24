import React, { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { alertsApi } from '../api/endpoints';
import { getErrorMessage } from '../api/client';
import { BellIcon } from '../components/icons';
import { PageHeader } from '../components/PageHeader';
import { Badge, Card, ErrorState, FilterChips, Muted, Screen, SectionLabel } from '../components/ui';
import { DetailSkeleton } from '../components/Skeleton';
import { useTabScrollPadding } from '../hooks/useTabScrollPadding';
import { colors, fonts } from '../theme/tokens';

const WINDOWS = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
];

function dayText(days: number) {
  if (days < 0) return `expired ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago`;
  if (days === 0) return 'expires today';
  return `expires in ${days} day${days === 1 ? '' : 's'}`;
}

export default function AlertsScreen({ navigation }: any) {
  const scrollPad = useTabScrollPadding(28);
  const [days, setDays] = useState('30');
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (soft = false) => {
      if (soft) setRefreshing(true);
      try {
        const { data: res } = await alertsApi.get(Number(days));
        setData(res);
        setError('');
      } catch (e) {
        setError(getErrorMessage(e));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [days]
  );

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  if (loading && !data) return <DetailSkeleton />;
  if (error && !data) return <ErrorState message={error} onRetry={() => void load()} />;

  const low: any[] = data?.low_stock || [];
  const expired: any[] = data?.expired || [];
  const soon: any[] = data?.expiring_soon || [];
  const total = data?.summary?.total ?? 0;

  const openBatch = (id: number) => navigation.navigate('Inventory', { screen: 'BatchDetail', params: { id } });
  const openItem = (code: string) =>
    navigation.navigate('Inventory', { screen: 'InventoryList', params: { q: code, focusSearch: Date.now() } });

  const batchRow = (b: any, tone: 'danger' | 'warning') => (
    <Pressable key={b.batch_id} onPress={() => openBatch(b.batch_id)} style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <Text style={{ fontFamily: fonts.uiBold, color: colors.navy, flexShrink: 1 }}>{b.batch_code}</Text>
          <Badge label={dayText(b.days_left)} tone={tone} />
        </View>
        <Muted>
          {b.item_name} · {b.available_qty} left · expiry {b.expiry_date}
        </Muted>
      </Card>
    </Pressable>
  );

  return (
    <Screen style={{ padding: 0 }}>
      <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ padding: 16, paddingBottom: scrollPad }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.primary} />}
      >
        <PageHeader
          title="Stock alerts"
          subtitle={total ? `${total} need attention` : 'All clear'}
          safeTop
          right={<BellIcon size={22} color={colors.primaryDark} />}
        />
        <Muted>Expiry window</Muted>
        <FilterChips options={WINDOWS} value={days} onChange={setDays} />
        {error ? <Text style={{ color: colors.danger, marginBottom: 8 }}>{error}</Text> : null}

        <SectionLabel>Low stock ({low.length})</SectionLabel>
        {low.length === 0 ? (
          <Muted>No monitored item is at or below its reorder level.</Muted>
        ) : (
          low.map((i) => (
            <Pressable key={i.item_id} onPress={() => openItem(i.item_code)} style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
              <Card>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <Text style={{ fontFamily: fonts.uiBold, color: colors.navy, flexShrink: 1 }}>{i.item_name}</Text>
                  <Badge label={i.out_of_stock ? 'Out of stock' : 'Low'} tone={i.out_of_stock ? 'danger' : 'warning'} />
                </View>
                <Muted>
                  {i.item_code} · {i.available_qty} {i.uom} available · reorder at {i.reorder_level}
                </Muted>
              </Card>
            </Pressable>
          ))
        )}

        <SectionLabel>Expired with stock ({expired.length})</SectionLabel>
        {expired.length === 0 ? <Muted>Nothing expired.</Muted> : expired.map((b) => batchRow(b, 'danger'))}

        <SectionLabel>Expiring within {data?.window_days ?? days} days ({soon.length})</SectionLabel>
        {soon.length === 0 ? <Muted>Nothing expiring soon.</Muted> : soon.map((b) => batchRow(b, 'warning'))}

        <View style={{ marginTop: 12 }}>
          <Muted>
            Low-stock alerts need a reorder level on the item (Stock, Items). Expiry alerts need an expiry date on the
            batch (open a batch and set it). Only QA-passed stock counts toward low stock.
          </Muted>
        </View>
      </ScrollView>
    </Screen>
  );
}
