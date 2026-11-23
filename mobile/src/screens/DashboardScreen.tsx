import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { dashboardApi, warehouseApi } from '../api/endpoints';
import { getErrorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import {
  BellIcon,
  ChartIcon,
  CubeIcon,
  DocIcon,
  OutIcon,
  PinIcon,
  RackIcon,
  ScanIcon,
  SearchIcon,
  UserAvatarIcon,
} from '../components/icons';
import { ErrorState, Muted } from '../components/ui';
import { DashboardSkeleton } from '../components/Skeleton';
import { colors, fonts, radius, shadow, spacing } from '../theme/tokens';
import { useTabScrollPadding } from '../hooks/useTabScrollPadding';
import { canAccess, roleLabel } from '../utils/roles';

const PAGE_BG = '#EEF2F6';
const CARD = '#FFFFFF';

function formatQty(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function timeAgo(iso?: string | null) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

type ActionItem = {
  title: string;
  tab: string;
  tone: 'primary' | 'accent' | 'success' | 'navy' | 'violet';
  icon: (color: string) => React.ReactNode;
};

export default function DashboardScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const scrollPad = useTabScrollPadding(28);
  const scrollRef = useRef<ScrollView>(null);
  const alertsY = useRef(0);
  const [data, setData] = useState<any>(null);
  const [warehouseLabel, setWarehouseLabel] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedAction, setSelectedAction] = useState<string | null>(null);
  const hasDataRef = useRef(false);

  const load = useCallback(async (opts?: { soft?: boolean }) => {
    setError('');
    if (opts?.soft) setRefreshing(true);
    else if (!hasDataRef.current) setLoading(true);
    try {
      const [dash, wh] = await Promise.all([
        dashboardApi.get(),
        warehouseApi.warehouses().catch(() => null),
      ]);
      setData(dash.data);
      hasDataRef.current = true;
      const rows = Array.isArray(wh?.data) ? wh.data : wh?.data?.results || [];
      const first = rows[0];
      if (first?.name || first?.code) {
        setWarehouseLabel(String(first.name || first.code));
      }
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      // Silent refresh when data already exists; pull-to-refresh uses soft spinner.
      void load();
    }, [load])
  );

  const actions = useMemo(() => {
    const role = user?.role;
    const items: ActionItem[] = [];
    if (canAccess(role, 'scanner')) {
      items.push({
        title: 'Scan',
        tab: 'Scanner',
        tone: 'primary',
        icon: (c) => <ScanIcon size={22} color={c} />,
      });
    }
    if (canAccess(role, 'withdrawal')) {
      items.push({
        title: 'Withdraw',
        tab: 'Withdrawal',
        tone: 'accent',
        icon: (c) => <OutIcon size={22} color={c} />,
      });
    }
    if (canAccess(role, 'warehouse')) {
      items.push({
        title: 'Floors',
        tab: 'Warehouse',
        tone: 'navy',
        icon: (c) => <RackIcon size={22} color={c} />,
      });
    }
    if (canAccess(role, 'grn')) {
      items.push({
        title: 'GRN',
        tab: 'GRN',
        tone: 'success',
        icon: (c) => <DocIcon size={22} color={c} />,
      });
    }
    if (canAccess(role, 'reports')) {
      items.push({
        title: 'Reports',
        tab: 'Reports',
        tone: 'primary',
        icon: (c) => <ChartIcon size={22} color={c} />,
      });
    }
    if (canAccess(role, 'inventory')) {
      items.push({
        title: 'Stock',
        tab: 'Inventory',
        tone: 'violet',
        icon: (c) => <CubeIcon size={22} color={c} />,
      });
    }
    return items;
  }, [user?.role]);

  const openAction = (tab: string) => {
    setSelectedAction(tab);
    if (tab === 'Withdrawal') {
      navigation.navigate('Withdrawal', {
        screen: 'WithdrawalMain',
        params: { batchId: undefined, unitId: undefined, resetKey: Date.now() },
      });
      return;
    }
    navigation.navigate(tab);
  };

  const openStockSearch = () => {
    const q = search.trim();
    navigation.navigate('Inventory', {
      screen: 'InventoryList',
      params: q ? { q, focusSearch: Date.now() } : undefined,
    });
  };

  if (loading && !data) return <DashboardSkeleton />;
  if (error && !data) return <ErrorState message={error} onRetry={load} />;

  const fifoAlerts = data?.fifo_alerts || [];
  const lowStock = data?.low_stock_alerts || [];
  const alertCount = fifoAlerts.length + lowStock.length;
  const recentTx = data?.recent_transactions || [];
  const recentWithdrawals = data?.recent_withdrawals || [];
  const available = Number(data?.available_quantity) || 0;
  const totalInventory = Number(data?.total_inventory) || 0;
  const availablePct =
    totalInventory > 0 ? Math.min(100, Math.round((available / totalInventory) * 100)) : 0;
  const withdrawCount = recentWithdrawals.length;
  const allocateCount = recentTx.filter((t: any) => t.type === 'ALLOCATE' || t.type === 'RECEIVE').length;

  const legend = [
    { label: 'Racks', color: '#3B82F6', value: data?.total_racks },
    { label: 'Batches', color: '#60A5FA', value: data?.bulk_batches },
    { label: 'Units', color: '#93C5FD', value: data?.individual_units },
    { label: 'GRN', color: '#F59E0B', value: data?.pending_grns },
    { label: 'QA', color: '#FDBA74', value: data?.testing_pending },
    { label: 'Alerts', color: '#9CA3AF', value: alertCount },
  ];

  return (
    <View style={styles.root}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{
          paddingBottom: scrollPad,
          paddingTop: Math.max(insets.top, 8) + 4,
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void load({ soft: true })}
            tintColor={colors.primary}
          />
        }
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <View style={{ flex: 1, minWidth: 0, paddingRight: 8 }}>
              <Text style={styles.hello} numberOfLines={1}>
                Hello, {user?.first_name || user?.username}
              </Text>
              <Text style={styles.roleLine} numberOfLines={1}>
                {roleLabel(user?.role)}
                {warehouseLabel ? ` · ${warehouseLabel}` : ''}
              </Text>
            </View>
            <View style={styles.headerActions}>
              <Pressable
                onPress={() =>
                  scrollRef.current?.scrollTo({
                    y: Math.max(0, alertsY.current - 12),
                    animated: true,
                  })
                }
                style={({ pressed }) => [styles.iconBtn, { opacity: pressed ? 0.88 : 1 }]}
              >
                <BellIcon size={18} color={colors.navy} />
                {alertCount > 0 ? (
                  <View style={styles.badgeDot}>
                    <Text style={styles.badgeDotText}>{alertCount > 9 ? '9+' : alertCount}</Text>
                  </View>
                ) : null}
              </Pressable>
              <Pressable
                onPress={() => navigation.navigate('Profile')}
                style={({ pressed }) => [{ opacity: pressed ? 0.88 : 1 }]}
              >
                <UserAvatarIcon size={40} color="#fff" backgroundColor="#5B6472" />
              </Pressable>
            </View>
          </View>

          {warehouseLabel ? (
            <Pressable
              onPress={() => canAccess(user?.role, 'warehouse') && navigation.navigate('Warehouse')}
              style={styles.locationPill}
            >
              <PinIcon size={14} color={colors.primary} />
              <Text style={styles.locationText} numberOfLines={1}>
                {warehouseLabel}
              </Text>
            </Pressable>
          ) : null}

          <View style={styles.searchRow}>
            <View style={styles.searchBox}>
              <SearchIcon size={18} color="#94A3B8" />
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder="Search SKU, bin, barcode, order…"
                placeholderTextColor="#94A3B8"
                style={styles.searchInput}
                returnKeyType="search"
                onSubmitEditing={openStockSearch}
              />
            </View>
            {canAccess(user?.role, 'scanner') ? (
              <Pressable
                onPress={() => navigation.navigate('Scanner')}
                style={({ pressed }) => [styles.scanBtn, { opacity: pressed ? 0.92 : 1 }]}
              >
                <ScanIcon size={22} color="#fff" />
              </Pressable>
            ) : null}
          </View>
        </View>

        {/* Metric strip — horizontal like the mock */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.metricsRow}
          decelerationRate="fast"
        >
          <MetricCard
            label="Available"
            value={formatQty(data?.available_quantity)}
            hint={`${formatQty(data?.bulk_batches)} batches`}
            tone="success"
            chart="spark"
            onPress={
              canAccess(user?.role, 'inventory')
                ? () =>
                    navigation.navigate('Inventory', {
                      screen: 'InventoryList',
                      params: { resetFilters: Date.now(), focusSearch: Date.now() },
                    })
                : undefined
            }
          />
          <MetricCard
            label="Low Stock"
            value={`${lowStock.length}`}
            hint={lowStock.length ? 'Qty ≤ 10' : 'None flagged'}
            tone="warning"
            chart="bars"
            onPress={
              canAccess(user?.role, 'inventory')
                ? () =>
                    navigation.navigate('Inventory', {
                      screen: 'InventoryList',
                      params: { lowStock: '1', focusSearch: Date.now() },
                    })
                : undefined
            }
          />
          <MetricCard
            label="Inbound GRN"
            value={formatQty(data?.pending_grns)}
            hint="Draft receipts"
            tone="primary"
            chart="lanes"
            onPress={
              canAccess(user?.role, 'grn')
                ? () =>
                    navigation.navigate('GRN', {
                      screen: 'GRNList',
                      params: { q: 'DRAFT', focusSearch: Date.now() },
                    })
                : undefined
            }
          />
          <MetricCard
            label="QA pending"
            value={formatQty(data?.testing_pending)}
            hint="Awaiting test"
            tone="violet"
            chart="progress"
            onPress={
              canAccess(user?.role, 'inventory')
                ? () =>
                    navigation.navigate('Inventory', {
                      screen: 'InventoryList',
                      params: { testing: 'PENDING', focusSearch: Date.now() },
                    })
                : undefined
            }
          />
        </ScrollView>

        {/* Quick actions */}
        <Text style={styles.sectionTitle}>Quick actions</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.actionsRow}
        >
          {actions.map((a) => {
            const selected = selectedAction === a.tab;
            const color = actionColor(a.tone);
            return (
              <Pressable
                key={a.tab + a.title}
                onPress={() => openAction(a.tab)}
                style={({ pressed }) => [styles.actionChip, { opacity: pressed ? 0.9 : 1 }]}
              >
                <View
                  style={[
                    styles.actionIconWrap,
                    {
                      backgroundColor: selected ? colors.primarySoft : CARD,
                      borderColor: selected ? colors.primary : '#E5EAF0',
                    },
                    !selected && shadow.soft,
                  ]}
                >
                  {a.icon(color)}
                </View>
                <Text style={[styles.actionLabel, selected && { color: colors.primary }]}>
                  {a.title}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Capacity */}
        <View style={[styles.panel, shadow.soft]}>
          <View style={styles.capacityHead}>
            <Text style={styles.capacityTitle}>{availablePct}% Available</Text>
            <Text style={styles.capacitySub}>
              {formatQty(available)} / {formatQty(totalInventory)} stock units
            </Text>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${availablePct}%` as `${number}%` }]} />
          </View>
          <View style={styles.legendRow}>
            {legend.map((item) => (
              <View key={item.label} style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: item.color }]} />
                <Text style={styles.legendText}>
                  {item.label} {formatQty(item.value)}
                </Text>
              </View>
            ))}
          </View>
          <Text style={styles.capacityMeta}>
            Today: {withdrawCount} withdrawn · {allocateCount} received/stowed
          </Text>
        </View>

        {/* Critical alerts */}
        <View
          onLayout={(e) => {
            alertsY.current = e.nativeEvent.layout.y;
          }}
        >
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitleInline}>Critical alerts ({alertCount})</Text>
            {canAccess(user?.role, 'inventory') ? (
              <Pressable onPress={() => navigation.navigate('Inventory')} hitSlop={8}>
                <Text style={styles.seeAll}>See all</Text>
              </Pressable>
            ) : null}
          </View>

          {alertCount === 0 ? (
            <View style={[styles.panel, { marginBottom: spacing.md }]}>
              <Muted>No FIFO or low-stock alerts right now</Muted>
            </View>
          ) : (
            <View style={{ paddingHorizontal: spacing.md, gap: 10, marginBottom: spacing.md }}>
              {fifoAlerts.slice(0, 3).map((a: any, idx: number) => (
                <Pressable
                  key={`fifo-${a.older_id || a.older}-${idx}`}
                  onPress={() => {
                    if (!a.older_id) return;
                    navigation.navigate('Inventory', {
                      screen: a.kind === 'UNIT' ? 'UnitDetail' : 'BatchDetail',
                      params: { id: a.older_id },
                    });
                  }}
                  style={[styles.alertCard, { backgroundColor: '#FEECEC' }]}
                >
                  <View style={[styles.alertStripe, { backgroundColor: colors.danger }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.alertTitle} numberOfLines={1}>
                      {a.older} · {a.item}
                    </Text>
                    <Text style={styles.alertSub} numberOfLines={2}>
                      Critical: use before {a.newer} · Avail {a.older_available}
                    </Text>
                  </View>
                </Pressable>
              ))}
              {lowStock.slice(0, 2).map((a: any, idx: number) => (
                <Pressable
                  key={`low-${a.batch_code}-${idx}`}
                  onPress={() =>
                    navigation.navigate('Inventory', {
                      screen: 'InventoryList',
                      params: { lowStock: '1', focusSearch: Date.now() },
                    })
                  }
                  style={[styles.alertCard, { backgroundColor: '#FFF4E5' }]}
                >
                  <View style={[styles.alertStripe, { backgroundColor: colors.warning }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.alertTitle} numberOfLines={1}>
                      {a.batch_code} · {a.item__name}
                    </Text>
                    <Text style={styles.alertSub} numberOfLines={1}>
                      Low stock · Qty {a.available_qty}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>
          )}
        </View>

        {/* Recent movements */}
        <Text style={styles.sectionTitle}>Recent stock movements</Text>
        <View style={[styles.panel, { marginBottom: spacing.lg }]}>
          {recentTx.length === 0 && recentWithdrawals.length === 0 ? (
            <Muted>No recent stock movements</Muted>
          ) : (
            (recentTx.length > 0 ? recentTx.slice(0, 5) : recentWithdrawals.slice(0, 5)).map(
              (row: any, idx: number, arr: any[]) => {
                const isTx = row.display_type != null || row.type != null;
                const tone =
                  row.type === 'WITHDRAW'
                    ? { bg: '#E8F8EF', fg: colors.success }
                    : row.type === 'RECEIVE' || row.type === 'ALLOCATE'
                      ? { bg: colors.primarySoft, fg: colors.primary }
                      : { bg: '#EEEAFF', fg: '#6B5CE7' };
                return (
                  <Pressable
                    key={isTx ? `tx-${row.id}` : `wd-${row.id}`}
                    disabled={isTx}
                    onPress={() => {
                      if (isTx) return;
                      navigation.navigate('Withdrawal', {
                        screen: 'WithdrawalConfirm',
                        params: { id: row.id },
                      });
                    }}
                    style={[styles.activityRow, idx < arr.length - 1 && styles.rowDivider]}
                  >
                    <View style={[styles.activityIcon, { backgroundColor: tone.bg }]}>
                      {row.type === 'WITHDRAW' || !isTx ? (
                        <OutIcon size={16} color={tone.fg} />
                      ) : (
                        <CubeIcon size={16} color={tone.fg} />
                      )}
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.activityTitle} numberOfLines={1}>
                        {isTx
                          ? `${row.display_type || row.type}${row.quantity != null ? ` · ${row.quantity}` : ''}`
                          : `Withdrawal #${row.id} · ${row.purpose}`}
                      </Text>
                      <Text style={styles.activitySub} numberOfLines={1}>
                        {isTx
                          ? [row.user_name, row.to_location || row.from_location, row.purpose]
                              .filter(Boolean)
                              .join(' · ') || 'Stock movement'
                          : row.user}
                      </Text>
                    </View>
                    <Text style={styles.activityTime}>{timeAgo(row.created_at)}</Text>
                  </Pressable>
                );
              }
            )
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function actionColor(tone: ActionItem['tone']) {
  if (tone === 'accent') return colors.accent;
  if (tone === 'success') return colors.success;
  if (tone === 'navy') return colors.navy;
  if (tone === 'violet') return '#6B5CE7';
  return colors.primary;
}

function toneSoftBg(tone: ActionItem['tone']) {
  if (tone === 'accent') return colors.accentSoft;
  if (tone === 'success') return colors.successSoft;
  if (tone === 'navy') return '#E8EEF4';
  if (tone === 'violet') return '#EEEAFF';
  return colors.primarySoft;
}

function MetricCard({
  label,
  value,
  hint,
  tone,
  chart,
  onPress,
}: {
  label: string;
  value: string;
  hint: string;
  tone: 'success' | 'warning' | 'primary' | 'violet';
  chart: 'spark' | 'bars' | 'lanes' | 'progress';
  onPress?: () => void;
}) {
  const palette =
    tone === 'success'
      ? { bg: '#E7F7EE', fg: '#1A8A55', soft: '#B7E4C7' }
      : tone === 'warning'
        ? { bg: '#FFF3E0', fg: '#C47A12', soft: '#F5D09A' }
        : tone === 'violet'
          ? { bg: '#EEEAFF', fg: '#6B5CE7', soft: '#C9C2F5' }
          : { bg: '#E7F0FB', fg: '#1A6BB5', soft: '#A8C8EA' };

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}. ${hint}`}
      style={({ pressed }) => [
        styles.metricCard,
        { backgroundColor: palette.bg, opacity: pressed && onPress ? 0.9 : 1 },
      ]}
    >
      <Text style={[styles.metricLabel, { color: palette.fg }]}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={[styles.metricHint, { color: palette.fg }]}>{hint}</Text>
      <View style={styles.chartWrap}>
        <MiniChart kind={chart} color={palette.fg} soft={palette.soft} />
      </View>
    </Pressable>
  );
}

function MiniChart({
  kind,
  color,
  soft,
}: {
  kind: 'spark' | 'bars' | 'lanes' | 'progress';
  color: string;
  soft: string;
}) {
  if (kind === 'spark') {
    return (
      <Svg width="100%" height={28} viewBox="0 0 120 28">
        <Path
          d="M2 20 C18 18, 28 8, 42 12 S70 24, 88 10 S110 6, 118 14"
          stroke={color}
          strokeWidth={2.2}
          fill="none"
          strokeLinecap="round"
        />
      </Svg>
    );
  }
  if (kind === 'bars') {
    const heights = [10, 16, 12, 20, 14, 18];
    return (
      <Svg width="100%" height={28} viewBox="0 0 120 28">
        {heights.map((h, i) => (
          <Rect
            key={i}
            x={8 + i * 18}
            y={26 - h}
            width={10}
            height={h}
            rx={3}
            fill={i % 2 === 0 ? color : soft}
          />
        ))}
      </Svg>
    );
  }
  if (kind === 'lanes') {
    return (
      <Svg width="100%" height={28} viewBox="0 0 120 28">
        <Rect x={4} y={4} width={90} height={5} rx={2.5} fill={color} />
        <Rect x={4} y={12} width={70} height={5} rx={2.5} fill={soft} />
        <Rect x={4} y={20} width={50} height={5} rx={2.5} fill={color} opacity={0.55} />
      </Svg>
    );
  }
  return (
    <Svg width="100%" height={28} viewBox="0 0 120 28">
      <Rect x={4} y={11} width={112} height={8} rx={4} fill={soft} />
      <Rect x={4} y={11} width={78} height={8} rx={4} fill={color} />
    </Svg>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: PAGE_BG },
  header: { paddingHorizontal: spacing.md, marginBottom: 6 },
  headerTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  hello: {
    fontFamily: fonts.display,
    fontSize: 28,
    letterSpacing: -0.7,
    color: colors.navy,
  },
  roleLine: {
    fontFamily: fonts.uiMedium,
    fontSize: 13,
    color: '#7B8794',
    marginTop: 3,
  },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: CARD,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.soft,
  },
  badgeDot: {
    position: 'absolute',
    top: 5,
    right: 5,
    minWidth: 15,
    height: 15,
    borderRadius: 8,
    paddingHorizontal: 3,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeDotText: { color: '#fff', fontSize: 9, fontFamily: fonts.uiBold },
  locationPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: CARD,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  locationText: {
    fontFamily: fonts.uiSemi,
    fontSize: 12,
    color: colors.navy,
    maxWidth: 220,
  },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: CARD,
    borderRadius: 16,
    paddingHorizontal: 14,
    height: 50,
    borderWidth: 1,
    borderColor: '#E5EAF0',
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.ui,
    fontSize: 15,
    color: colors.text,
    paddingVertical: 0,
  },
  scanBtn: {
    width: 50,
    height: 50,
    borderRadius: 14,
    backgroundColor: '#F97316',
    alignItems: 'center',
    justifyContent: 'center',
  },
  metricsRow: {
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    gap: 10,
  },
  metricCard: {
    width: 148,
    borderRadius: 18,
    padding: 14,
    paddingBottom: 10,
    minHeight: 132,
  },
  metricLabel: { fontFamily: fonts.uiSemi, fontSize: 12 },
  metricValue: {
    fontFamily: fonts.displaySemi,
    fontSize: 26,
    color: colors.navy,
    marginTop: 6,
    letterSpacing: -0.5,
  },
  metricHint: { fontFamily: fonts.uiMedium, fontSize: 11, marginTop: 2, opacity: 0.85 },
  chartWrap: { marginTop: 10 },
  sectionTitle: {
    fontFamily: fonts.uiSemi,
    fontSize: 13,
    color: '#7B8794',
    paddingHorizontal: spacing.md,
    marginBottom: 10,
    marginTop: 4,
  },
  sectionTitleInline: {
    fontFamily: fonts.uiSemi,
    fontSize: 13,
    color: '#7B8794',
  },
  sectionHead: {
    paddingHorizontal: spacing.md,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  seeAll: { fontFamily: fonts.uiSemi, fontSize: 13, color: colors.primary },
  actionsRow: { paddingHorizontal: spacing.md, gap: 12, paddingBottom: 14 },
  actionChip: {
    width: 72,
    alignItems: 'center',
  },
  actionIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
    backgroundColor: CARD,
    borderWidth: 1.5,
    borderColor: '#E5EAF0',
  },
  actionLabel: {
    fontFamily: fonts.uiSemi,
    fontSize: 12,
    color: colors.text,
    textAlign: 'center',
  },
  panel: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    backgroundColor: CARD,
    borderRadius: 20,
    padding: 16,
  },
  capacityHead: { marginBottom: 12 },
  capacityTitle: {
    fontFamily: fonts.displaySemi,
    fontSize: 20,
    color: colors.navy,
  },
  capacitySub: {
    fontFamily: fonts.ui,
    fontSize: 13,
    color: '#7B8794',
    marginTop: 4,
  },
  progressTrack: {
    height: 12,
    borderRadius: 8,
    backgroundColor: '#E8EEF5',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#3B82F6',
    borderRadius: 8,
  },
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 14,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 2 },
  legendText: { fontFamily: fonts.uiMedium, fontSize: 11, color: '#64748B' },
  capacityMeta: {
    fontFamily: fonts.uiMedium,
    fontSize: 12,
    color: '#7B8794',
    marginTop: 12,
  },
  alertCard: {
    flexDirection: 'row',
    borderRadius: 16,
    overflow: 'hidden',
    paddingVertical: 12,
    paddingRight: 12,
  },
  alertStripe: { width: 4, marginRight: 12 },
  alertTitle: { fontFamily: fonts.uiSemi, fontSize: 14, color: colors.navy },
  alertSub: {
    fontFamily: fonts.ui,
    fontSize: 12,
    color: '#6B7280',
    marginTop: 3,
    lineHeight: 17,
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 11,
  },
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E8EEF4',
  },
  activityIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activityTitle: { fontFamily: fonts.uiSemi, fontSize: 14, color: colors.navy },
  activitySub: { fontFamily: fonts.ui, fontSize: 12, color: '#7B8794', marginTop: 2 },
  activityTime: { fontFamily: fonts.uiMedium, fontSize: 11, color: '#94A3B8' },
});
