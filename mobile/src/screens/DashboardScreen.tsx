import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { dashboardApi } from '../api/endpoints';
import { getErrorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import {
  ChartIcon,
  CubeIcon,
  DocIcon,
  OutIcon,
  RackIcon,
  ScanIcon,
} from '../components/icons';
import {
  ActionTile,
  Badge,
  Card,
  ErrorState,
  LoadingState,
  Metric,
  Muted,
  SectionLabel,
} from '../components/ui';
import { colors } from '../theme/tokens';
import { useTabScrollPadding } from '../hooks/useTabScrollPadding';
import { canAccess, roleLabel } from '../utils/roles';

export default function DashboardScreen() {
  const navigation = useNavigation<any>();
  const { user } = useAuth();
  const scrollPad = useTabScrollPadding(28);
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

  const actions = useMemo(() => {
    const role = user?.role;
    const items: {
      title: string;
      subtitle: string;
      tab: string;
      tone: 'primary' | 'accent' | 'success' | 'navy';
      icon: React.ReactNode;
    }[] = [];
    if (canAccess(role, 'scanner')) {
      items.push({
        title: 'Scan',
        subtitle: 'Find stock fast',
        tab: 'Scanner',
        tone: 'primary',
        icon: <ScanIcon size={22} color={colors.primaryDark} />,
      });
    }
    if (canAccess(role, 'withdrawal')) {
      items.push({
        title: 'Withdraw',
        subtitle: 'Ship / assemble',
        tab: 'Withdrawal',
        tone: 'accent',
        icon: <OutIcon size={22} color={colors.accent} />,
      });
    }
    if (canAccess(role, 'warehouse')) {
      items.push({
        title: 'Floors',
        subtitle: 'Floor maps & stock',
        tab: 'Warehouse',
        tone: 'navy',
        icon: <RackIcon size={22} color={colors.navy} />,
      });
    }
    if (canAccess(role, 'grn')) {
      items.push({
        title: canAccess(role, 'grnImport') ? 'GRN / Import' : 'GRN',
        subtitle: canAccess(role, 'grnImport') ? 'Receive & import' : 'View receipts',
        tab: 'GRN',
        tone: 'success',
        icon: <DocIcon size={22} color={colors.success} />,
      });
    }
    if (canAccess(role, 'reports')) {
      items.push({
        title: 'Reports',
        subtitle: 'Stock & FIFO',
        tab: 'Reports',
        tone: 'navy',
        icon: <ChartIcon size={22} color={colors.navy} />,
      });
    }
    if (canAccess(role, 'inventory')) {
      items.push({
        title: 'Inventory',
        subtitle: 'Batches & units',
        tab: 'Inventory',
        tone: 'primary',
        icon: <CubeIcon size={22} color={colors.primaryDark} />,
      });
    }
    return items.slice(0, 6);
  }, [user?.role]);

  if (loading && !data) return <LoadingState />;
  if (error && !data) return <ErrorState message={error} onRetry={load} />;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: scrollPad }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
      >
        <Text style={{ color: colors.muted, fontWeight: '700', fontSize: 12, letterSpacing: 0.7 }}>
          {roleLabel(user?.role).toUpperCase()}
        </Text>
        <Text
          style={{
            fontSize: 24,
            fontWeight: '800',
            color: colors.navy,
            letterSpacing: -0.4,
            marginTop: 4,
          }}
        >
          Hello, {user?.first_name || user?.username}
        </Text>
        <Muted>Live warehouse overview from PostgreSQL</Muted>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 18 }}>
          <Metric label="Available qty" value={data?.available_quantity ?? '—'} />
          <Metric label="Bulk batches" value={data?.bulk_batches ?? '—'} />
          <Metric label="Units" value={data?.individual_units ?? '—'} />
        </View>

        <SectionLabel>Quick actions</SectionLabel>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
          {actions.map((a) => (
            <ActionTile
              key={a.tab + a.title}
              title={a.title}
              subtitle={a.subtitle}
              tone={a.tone}
              icon={a.icon}
              onPress={() => {
                if (a.tab === 'Withdrawal') {
                  navigation.navigate('Withdrawal', {
                    screen: 'WithdrawalMain',
                    params: { batchId: undefined, unitId: undefined, resetKey: Date.now() },
                  });
                  return;
                }
                navigation.navigate(a.tab);
              }}
            />
          ))}
        </View>

        <SectionLabel>FIFO alerts</SectionLabel>
        <Card>
          {(data?.fifo_alerts || []).length === 0 ? <Muted>No FIFO conflicts right now</Muted> : null}
          {(data?.fifo_alerts || []).map((a: any, idx: number) => (
            <Pressable key={idx} style={{ marginBottom: idx === (data?.fifo_alerts?.length || 1) - 1 ? 0 : 12 }}>
              <Badge label="FIFO" tone="warning" />
              <Text style={{ marginTop: 6, color: colors.text, lineHeight: 20 }}>
                {a.item}: withdraw {a.older} before {a.newer} (avail {a.older_available})
              </Text>
            </Pressable>
          ))}
        </Card>

        <SectionLabel>Recent withdrawals</SectionLabel>
        <Card>
          {(data?.recent_withdrawals || []).length === 0 ? <Muted>No recent withdrawals</Muted> : null}
          {(data?.recent_withdrawals || []).map((w: any) => (
            <Text key={w.id} style={{ marginBottom: 8, color: colors.text }}>
              #{w.id} · {w.purpose} — {w.user}
            </Text>
          ))}
        </Card>
      </ScrollView>
    </View>
  );
}
