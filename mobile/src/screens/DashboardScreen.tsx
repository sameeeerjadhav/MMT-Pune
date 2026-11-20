import React, { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, Text, Pressable } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { dashboardApi } from '../api/endpoints';
import { getErrorMessage } from '../api/client';
import { Badge, Button, Card, ErrorState, LoadingState, Muted, Screen, Subtitle, Title } from '../components/ui';
import { colors } from '../theme/tokens';

export default function DashboardScreen() {
  const navigation = useNavigation<any>();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setError('');
    try {
      const res = await dashboardApi.get();
      setData(res.data);
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

  if (loading && !data) return <LoadingState />;
  if (error && !data) return <ErrorState message={error} onRetry={load} />;

  return (
    <Screen style={{ padding: 0 }}>
      <ScrollView
        contentContainerStyle={{ padding: 16 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
      >
        <Title>Dashboard</Title>
        <Muted>Live warehouse overview from PostgreSQL</Muted>

        <Card>
          <Subtitle>Stock snapshot</Subtitle>
          <Text style={styles.metric}>Available: {data?.available_quantity}</Text>
          <Text>Total inventory units/qty: {data?.total_inventory}</Text>
          <Text>Bulk batches: {data?.bulk_batches}</Text>
          <Text>Individual units: {data?.individual_units}</Text>
          <Text>Racks: {data?.total_racks}</Text>
          <Text>Pending GRNs: {data?.pending_grns}</Text>
        </Card>

        <Card>
          <Subtitle>Quick actions</Subtitle>
          <Button label="Scan Barcode" onPress={() => navigation.navigate('Scanner')} />
          <Button label="Receive / GRN" variant="secondary" onPress={() => navigation.navigate('GRN')} />
          <Button label="Manage Racks" variant="secondary" onPress={() => navigation.navigate('Warehouse')} />
          <Button label="Withdraw Inventory" variant="success" onPress={() => navigation.navigate('Withdrawal')} />
          <Button label="Reports" variant="secondary" onPress={() => navigation.navigate('Reports')} />
        </Card>

        <Card>
          <Subtitle>FIFO alerts</Subtitle>
          {(data?.fifo_alerts || []).length === 0 ? <Muted>No FIFO conflicts</Muted> : null}
          {(data?.fifo_alerts || []).map((a: any, idx: number) => (
            <Pressable key={idx} style={{ marginBottom: 8 }}>
              <Badge label="FIFO" tone="warning" />
              <Text style={{ marginTop: 4, color: colors.text }}>
                {a.item}: withdraw {a.older} before {a.newer} (avail {a.older_available})
              </Text>
            </Pressable>
          ))}
        </Card>

        <Card>
          <Subtitle>Recent withdrawals</Subtitle>
          {(data?.recent_withdrawals || []).map((w: any) => (
            <Text key={w.id} style={{ marginBottom: 6 }}>
              #{w.id} {w.purpose} — {w.user}
            </Text>
          ))}
        </Card>
      </ScrollView>
    </Screen>
  );
}

const styles = {
  metric: { fontSize: 22, fontWeight: '800' as const, color: colors.navy, marginVertical: 6 },
};
