import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
  Muted,
  SectionLabel,
} from '../components/ui';
import { colors, fonts, radius, spacing } from '../theme/tokens';
import { useTabScrollPadding } from '../hooks/useTabScrollPadding';
import { canAccess, roleLabel } from '../utils/roles';

export default function DashboardScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
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
        icon: <ScanIcon size={20} color={colors.primaryDark} />,
      });
    }
    if (canAccess(role, 'withdrawal')) {
      items.push({
        title: 'Withdraw',
        subtitle: 'Ship / assemble',
        tab: 'Withdrawal',
        tone: 'accent',
        icon: <OutIcon size={20} color={colors.accent} />,
      });
    }
    if (canAccess(role, 'warehouse')) {
      items.push({
        title: 'Floors',
        subtitle: 'Maps & putaway',
        tab: 'Warehouse',
        tone: 'navy',
        icon: <RackIcon size={20} color={colors.navy} />,
      });
    }
    if (canAccess(role, 'grn')) {
      items.push({
        title: canAccess(role, 'grnImport') ? 'GRN' : 'GRN',
        subtitle: canAccess(role, 'grnImport') ? 'Receive goods' : 'View receipts',
        tab: 'GRN',
        tone: 'success',
        icon: <DocIcon size={20} color={colors.success} />,
      });
    }
    if (canAccess(role, 'reports')) {
      items.push({
        title: 'Reports',
        subtitle: 'Stock & age order',
        tab: 'Reports',
        tone: 'navy',
        icon: <ChartIcon size={20} color={colors.navy} />,
      });
    }
    if (canAccess(role, 'inventory')) {
      items.push({
        title: 'Stock',
        subtitle: 'Batches & units',
        tab: 'Inventory',
        tone: 'primary',
        icon: <CubeIcon size={20} color={colors.primaryDark} />,
      });
    }
    return items.slice(0, 6);
  }, [user?.role]);

  if (loading && !data) return <LoadingState />;
  if (error && !data) return <ErrorState message={error} onRetry={load} />;

  const fifoCount = (data?.fifo_alerts || []).length;

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: scrollPad }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor="#fff" />}
      >
        <LinearGradient
          colors={[colors.heroFrom, colors.heroTo]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.hero, { paddingTop: Math.max(insets.top, 12) + 8 }]}
        >
          <Text style={styles.heroEyebrow}>{roleLabel(user?.role).toUpperCase()}</Text>
          <Text style={styles.heroTitle}>Hello, {user?.first_name || user?.username}</Text>

          <View style={styles.heroMetrics}>
            <View style={styles.heroMetric}>
              <Text style={styles.heroMetricValue}>{data?.available_quantity ?? '—'}</Text>
              <Text style={styles.heroMetricLabel}>Available</Text>
            </View>
            <View style={styles.heroMetricDivider} />
            <View style={styles.heroMetric}>
              <Text style={styles.heroMetricValue}>{data?.bulk_batches ?? '—'}</Text>
              <Text style={styles.heroMetricLabel}>Batches</Text>
            </View>
            <View style={styles.heroMetricDivider} />
            <View style={styles.heroMetric}>
              <Text style={styles.heroMetricValue}>{data?.individual_units ?? '—'}</Text>
              <Text style={styles.heroMetricLabel}>Units</Text>
            </View>
          </View>
        </LinearGradient>

        <View style={styles.body}>
          <SectionLabel>Quick actions</SectionLabel>
          <View style={styles.actionGrid}>
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

          <SectionLabel>Older stock alerts</SectionLabel>
          <Card>
            {fifoCount === 0 ? (
              <Muted>No older-stock conflicts right now</Muted>
            ) : (
              (data?.fifo_alerts || []).map((a: any, idx: number) => (
                <Pressable
                  key={`${a.older_id || a.older}-${a.newer_id || a.newer}-${idx}`}
                  onPress={() => {
                    if (a.older_id) {
                      navigation.navigate('Inventory', {
                        screen: 'BatchDetail',
                        params: { id: a.older_id },
                      });
                    }
                  }}
                  style={{ marginBottom: idx === fifoCount - 1 ? 0 : 14 }}
                >
                  <Badge label="Older first" tone="warning" />
                  <Text style={styles.alertText}>
                    {a.item}: withdraw {a.older} before {a.newer}
                  </Text>
                  <Muted>Avail {a.older_available}{a.older_id ? ' · Tap to open' : ''}</Muted>
                </Pressable>
              ))
            )}
          </Card>

          <SectionLabel>Recent withdrawals</SectionLabel>
          <Card>
            {(data?.recent_withdrawals || []).length === 0 ? (
              <Muted>No recent withdrawals</Muted>
            ) : (
              (data?.recent_withdrawals || []).map((w: any, idx: number, arr: any[]) => (
                <Pressable
                  key={w.id}
                  onPress={() =>
                    navigation.navigate('Withdrawal', {
                      screen: 'WithdrawalConfirm',
                      params: { id: w.id },
                    })
                  }
                  style={[styles.rowItem, idx < arr.length - 1 && styles.rowDivider]}
                >
                  <Text style={styles.rowTitle}>
                    #{w.id} · {w.purpose}
                  </Text>
                  <Muted>{w.user}</Muted>
                </Pressable>
              ))
            )}
          </Card>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  hero: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
  },
  heroEyebrow: {
    fontFamily: fonts.uiSemi,
    color: 'rgba(255,255,255,0.72)',
    fontSize: 11,
    letterSpacing: 1.1,
  },
  heroTitle: {
    fontFamily: fonts.display,
    color: '#fff',
    fontSize: 30,
    letterSpacing: -0.7,
    marginTop: 6,
  },
  heroMetrics: {
    marginTop: spacing.lg,
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderRadius: radius.lg,
    paddingVertical: 14,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  heroMetric: { flex: 1, alignItems: 'center' },
  heroMetricValue: {
    fontFamily: fonts.displaySemi,
    color: '#fff',
    fontSize: 20,
    letterSpacing: -0.3,
  },
  heroMetricLabel: {
    fontFamily: fonts.uiMedium,
    color: 'rgba(255,255,255,0.7)',
    fontSize: 11,
    marginTop: 2,
  },
  heroMetricDivider: {
    width: 1,
    backgroundColor: 'rgba(255,255,255,0.2)',
    marginVertical: 2,
  },
  body: { padding: spacing.md, paddingTop: spacing.lg },
  actionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  alertText: {
    fontFamily: fonts.uiMedium,
    marginTop: 6,
    color: colors.text,
    lineHeight: 20,
  },
  rowItem: { paddingVertical: 8 },
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSoft,
  },
  rowTitle: {
    fontFamily: fonts.uiSemi,
    color: colors.text,
  },
});
