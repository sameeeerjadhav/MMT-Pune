import React, { useCallback, useMemo, useRef, useState } from 'react';
import { FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { inventoryApi } from '../api/endpoints';
import { getErrorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import {
  Badge,
  Button,
  Card,
  ErrorState,
  FilterChips,
  FormActions,
  Muted,
  Screen,
  SearchInput,
  SectionLabel,
  TextAction,
} from '../components/ui';
import { ListSkeleton } from '../components/Skeleton';
import { PageHeader } from '../components/PageHeader';
import { EmptyBoxIcon, StockLogo } from '../components/icons';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useTabScrollPadding } from '../hooks/useTabScrollPadding';
import { colors, fonts, radius, spacing } from '../theme/tokens';
import { canAccess } from '../utils/roles';

function stockThumbUri(url?: string | null, updatedAt?: string | null) {
  if (!url) return null;
  // Bust RN Image cache when the same path is replaced with a new upload.
  const sep = url.includes('?') ? '&' : '?';
  const stamp = updatedAt || url;
  return `${url}${sep}t=${encodeURIComponent(String(stamp))}`;
}

type StockType = '' | 'BATCH' | 'UNIT';
type TestingFilter = '' | 'PENDING' | 'PASSED' | 'FAILED';
type AllocatedFilter = '' | '1' | '0';
type SortKey =
  | 'received_at'
  | '-received_at'
  | 'code'
  | '-code'
  | 'item'
  | '-item'
  | 'qty'
  | '-qty';

type FilterState = {
  stockType: StockType;
  testing: TestingFilter;
  allocated: AllocatedFilter;
  ordering: SortKey;
};

/** Default: newest stock first. Edits must not change position (sort by received_at/id only). */
const DEFAULT_ORDERING: SortKey = '-received_at';

const EMPTY_FILTERS: FilterState = {
  stockType: '',
  testing: '',
  allocated: '',
  ordering: DEFAULT_ORDERING,
};

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: '-received_at', label: 'Newest first' },
  { value: 'received_at', label: 'Oldest first' },
  { value: 'code', label: 'Code A–Z' },
  { value: '-code', label: 'Code Z–A' },
  { value: 'item', label: 'Item A–Z' },
  { value: '-item', label: 'Item Z–A' },
  { value: 'qty', label: 'Qty low→high' },
  { value: '-qty', label: 'Qty high→low' },
];

function summarizeFilters(f: FilterState) {
  const parts: string[] = [];
  if (f.stockType === 'BATCH') parts.push('Batch');
  if (f.stockType === 'UNIT') parts.push('Unit');
  if (f.testing) parts.push(f.testing.charAt(0) + f.testing.slice(1).toLowerCase());
  if (f.allocated === '1') parts.push('In use');
  if (f.allocated === '0') parts.push('Not allocated');
  const sortLabel = SORT_OPTIONS.find((o) => o.value === f.ordering)?.label;
  if (sortLabel && f.ordering !== DEFAULT_ORDERING) parts.push(sortLabel);
  return parts.join(' · ');
}

function sortRowsClient(rows: any[], ordering: SortKey) {
  const copy = [...rows];
  const dir = ordering.startsWith('-') ? -1 : 1;
  const key = ordering.replace(/^-/, '') as 'received_at' | 'code' | 'item' | 'qty';
  copy.sort((a, b) => {
    let av: string | number = '';
    let bv: string | number = '';
    if (key === 'code') {
      av = String(a.kind === 'BATCH' ? a.batch_code : a.unit_code || '').toLowerCase();
      bv = String(b.kind === 'BATCH' ? b.batch_code : b.unit_code || '').toLowerCase();
    } else if (key === 'item') {
      av = String(a.item?.name || '').toLowerCase();
      bv = String(b.item?.name || '').toLowerCase();
    } else if (key === 'qty') {
      av = a.kind === 'BATCH' ? Number(a.available_qty || 0) : 1;
      bv = b.kind === 'BATCH' ? Number(b.available_qty || 0) : 1;
    } else {
      // received_at only — never updated_at, so edits keep the same place.
      av = String(a.received_at || '');
      bv = String(b.received_at || '');
    }
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    // Stable tie-break by id (same direction as sort) so reloads don't reshuffle.
    const aid = Number(a.id || 0);
    const bid = Number(b.id || 0);
    if (aid < bid) return -1 * dir;
    if (aid > bid) return 1 * dir;
    return 0;
  });
  return copy;
}

export default function InventoryListScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { user } = useAuth();
  // Filters/sort are for all warehouse roles (employee, supervisor, admin).
  const canManage = canAccess(user?.role, 'manageMasterData');
  const scrollPad = useTabScrollPadding(28);
  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q, 160);
  const [applied, setApplied] = useState<FilterState>(EMPTY_FILTERS);
  const [draft, setDraft] = useState<FilterState>(EMPTY_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const hasRows = useRef(false);
  const appliedSearchKey = useRef('');

  // Optional deep-link from dashboard (search / QA / low-stock / reset).
  useFocusEffect(
    useCallback(() => {
      const nextQ = typeof route.params?.q === 'string' ? route.params.q.trim() : '';
      const testing = route.params?.testing;
      const lowStock = route.params?.lowStock;
      const resetFilters = route.params?.resetFilters;
      const key = `${nextQ}|${testing || ''}|${lowStock || ''}|${resetFilters || ''}|${route.params?.focusSearch ?? ''}`;
      if (!route.params?.focusSearch && !nextQ && !testing && !lowStock && !resetFilters) return;
      if (key === appliedSearchKey.current) return;
      appliedSearchKey.current = key;

      // Deep links describe the whole view: a metric card must not combine with an old search.
      setQ(nextQ);

      if (resetFilters) {
        setLowStockOnly(false);
        setApplied(EMPTY_FILTERS);
        setDraft(EMPTY_FILTERS);
        return;
      }

      if (testing === 'PENDING' || testing === 'PASSED' || testing === 'FAILED') {
        setLowStockOnly(false);
        const next = { ...EMPTY_FILTERS, testing };
        setApplied(next);
        setDraft(next);
        return;
      }

      // Low-stock deep-link: batches with 0 < qty ≤ 10 (matches dashboard alerts).
      if (lowStock === '1') {
        setLowStockOnly(true);
        const next = { ...EMPTY_FILTERS, stockType: 'BATCH' as StockType };
        setApplied(next);
        setDraft(next);
      }
    }, [
      route.params?.q,
      route.params?.testing,
      route.params?.lowStock,
      route.params?.resetFilters,
      route.params?.focusSearch,
    ])
  );

  const filtersActive = Boolean(
    applied.stockType ||
      applied.testing ||
      applied.allocated ||
      lowStockOnly ||
      applied.ordering !== DEFAULT_ORDERING
  );
  const activeSummary = useMemo(() => {
    const base = summarizeFilters(applied);
    if (!lowStockOnly) return base;
    return [base, 'Low stock ≤10'].filter(Boolean).join(' · ');
  }, [applied, lowStockOnly]);

  const openFilters = () => {
    setDraft(applied);
    setFiltersOpen(true);
  };

  const closeFilters = () => {
    setDraft(applied);
    setFiltersOpen(false);
  };

  const toggleFilters = () => {
    if (filtersOpen) closeFilters();
    else openFilters();
  };

  const applyFilters = () => {
    // Manual filter sheet replaces the dashboard low-stock deep-link mode.
    setLowStockOnly(false);
    setApplied(draft);
    setFiltersOpen(false);
  };

  // Draft only — low-stock mode is dropped when the user presses Apply, so Cancel keeps it.
  const clearDraft = () => {
    setDraft({ ...EMPTY_FILTERS });
  };

  useFocusEffect(
    useCallback(() => {
      const controller = new AbortController();
      const soft = hasRows.current;
      (async () => {
        setError('');
        if (soft) setSearching(true);
        else setLoading(true);
        try {
          const { data } = await inventoryApi.list(
            {
              q: debouncedQ.trim() || undefined,
              type: applied.stockType || undefined,
              testing_status: applied.testing || undefined,
              allocated: applied.allocated || undefined,
              ordering: applied.ordering || undefined,
              low_stock: lowStockOnly ? '1' : undefined,
              limit: 80,
            },
            { signal: controller.signal }
          );
          if (controller.signal.aborted) return;
          let batches = (data.batches || []).map((b: any) => ({ kind: 'BATCH', ...b }));
          let units = (data.units || []).map((u: any) => ({ kind: 'UNIT', ...u }));
          // Client safety net if an older API ignores low_stock=.
          if (lowStockOnly) {
            batches = batches.filter((b: any) => {
              const qty = Number(b.available_qty);
              return Number.isFinite(qty) && qty > 0 && qty <= 10;
            });
            units = [];
          }
          // Client merge + sort so mixed batch/unit lists stay ordered when API returns both.
          setRows(sortRowsClient([...batches, ...units], applied.ordering));
          hasRows.current = true;
        } catch (e: any) {
          if (controller.signal.aborted || e?.code === 'ERR_CANCELED' || e?.name === 'CanceledError') {
            return;
          }
          setError(getErrorMessage(e));
        } finally {
          if (!controller.signal.aborted) {
            setLoading(false);
            setSearching(false);
          }
        }
      })();
      return () => {
        controller.abort();
      };
    }, [
      debouncedQ,
      applied.stockType,
      applied.testing,
      applied.allocated,
      applied.ordering,
      lowStockOnly,
      reloadKey,
    ])
  );

  if (loading && !rows.length) return <ListSkeleton rows={7} titleWidth="28%" />;
  if (error && !rows.length) {
    return (
      <ErrorState
        message={error}
        onRetry={() => {
          setError('');
          hasRows.current = false;
          setLoading(true);
          setReloadKey((k) => k + 1);
        }}
      />
    );
  }

  const header = (
    <View style={styles.header}>
      <PageHeader title="Stock" safeTop />
      <SearchInput
        placeholder="Search item, batch, barcode..."
        value={q}
        onChangeText={setQ}
        searching={searching}
        onClear={() => setQ('')}
        onFilterPress={toggleFilters}
        filterOpen={filtersOpen}
        filterActive={filtersActive}
      />
      {filtersOpen ? (
        <Card style={styles.filterCard}>
          <View style={styles.filterHeader}>
            <Text style={styles.filterTitle}>Filters & sort</Text>
            {draft.stockType ||
            draft.testing ||
            draft.allocated ||
            draft.ordering !== DEFAULT_ORDERING ? (
              <TextAction label="Clear" onPress={clearDraft} />
            ) : null}
          </View>
          <Text style={styles.filterGroup}>Type</Text>
          <FilterChips
            value={draft.stockType}
            onChange={(v) => setDraft((d) => ({ ...d, stockType: v as StockType }))}
            options={[
              { value: '', label: 'All' },
              { value: 'BATCH', label: 'Batch' },
              { value: 'UNIT', label: 'Unit' },
            ]}
          />
          <Text style={styles.filterGroup}>QA status</Text>
          <FilterChips
            value={draft.testing}
            onChange={(v) => setDraft((d) => ({ ...d, testing: v as TestingFilter }))}
            options={[
              { value: '', label: 'All QA' },
              { value: 'PASSED', label: 'Passed' },
              { value: 'PENDING', label: 'Pending' },
              { value: 'FAILED', label: 'Failed' },
            ]}
          />
          <Text style={styles.filterGroup}>Location</Text>
          <FilterChips
            value={draft.allocated}
            onChange={(v) => setDraft((d) => ({ ...d, allocated: v as AllocatedFilter }))}
            options={[
              { value: '', label: 'Any location' },
              { value: '1', label: 'In use' },
              { value: '0', label: 'Not allocated' },
            ]}
          />
          <Text style={styles.filterGroup}>Sort by</Text>
          <FilterChips
            value={draft.ordering}
            onChange={(v) => setDraft((d) => ({ ...d, ordering: v as SortKey }))}
            options={SORT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          />
          <FormActions primaryLabel="Apply" onPrimary={applyFilters} onCancel={closeFilters} />
        </Card>
      ) : filtersActive ? (
        <View style={styles.activePill}>
          <Text style={styles.activePillText}>{activeSummary}</Text>
          <TextAction
            label="Clear"
            tone="muted"
            onPress={() => {
              setLowStockOnly(false);
              setApplied({ ...EMPTY_FILTERS });
            }}
          />
        </View>
      ) : null}
      {canManage ? (
        <Button label="Manage items" variant="secondary" onPress={() => navigation.navigate('ItemMaster')} />
      ) : null}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      <SectionLabel>{rows.length} results</SectionLabel>
    </View>
  );

  return (
    <Screen>
      <FlatList showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: scrollPad }}
        data={rows}
        keyExtractor={(item) => `${item.kind}-${item.id}`}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <Card>
            <View style={styles.empty}>
              <EmptyBoxIcon size={64} />
              <Muted>No inventory matched your search or filters.</Muted>
            </View>
          </Card>
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() =>
              navigation.navigate(item.kind === 'BATCH' ? 'BatchDetail' : 'UnitDetail', { id: item.id })
            }
            style={({ pressed }) => [{ opacity: pressed ? 0.92 : 1 }]}
          >
            <Card style={styles.stockCard}>
              <View style={styles.row}>
                {stockThumbUri(item.item?.image_url, item.item?.updated_at) ? (
                  <Image
                    source={{
                      uri: stockThumbUri(item.item?.image_url, item.item?.updated_at)!,
                    }}
                    style={styles.thumb}
                    resizeMode="cover"
                  />
                ) : (
                  <StockLogo size={76} />
                )}
                <View style={styles.rowBody}>
                  <View style={styles.rowTop}>
                    <Text style={styles.code} numberOfLines={1}>
                      {item.kind === 'BATCH' ? item.batch_code : item.unit_code}
                    </Text>
                    <Badge label={item.kind} tone={item.kind === 'BATCH' ? 'primary' : 'success'} />
                  </View>
                  <Text style={styles.itemName} numberOfLines={2}>
                    {item.item?.name}
                  </Text>
                  <Text style={styles.meta}>
                    {item.kind === 'BATCH'
                      ? `Available ${item.available_qty} · QA ${item.testing_status || '—'}`
                      : `Status ${item.status} · QA ${item.testing_status || '—'}`}
                  </Text>
                </View>
              </View>
            </Card>
          </Pressable>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { marginBottom: spacing.xs },
  filterCard: { marginTop: spacing.xs },
  filterHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  filterTitle: {
    fontFamily: fonts.uiSemi,
    color: colors.navy,
    fontSize: 15,
  },
  filterGroup: {
    fontFamily: fonts.uiMedium,
    color: colors.muted,
    fontSize: 12,
    marginBottom: 6,
    marginTop: 4,
  },
  activePill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: spacing.sm,
  },
  activePillText: {
    fontFamily: fonts.uiMedium,
    color: colors.primaryDark,
    fontSize: 13,
    flex: 1,
    marginRight: 8,
  },
  errorText: {
    fontFamily: fonts.ui,
    color: colors.danger,
    marginBottom: 8,
  },
  empty: { alignItems: 'center', paddingVertical: 12 },
  stockCard: {
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
    // Flat card — no drop shadow / elevation tint behind the box.
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0,
    borderColor: colors.borderSoft,
  },
  thumb: {
    width: 72,
    height: 72,
    borderRadius: 18,
    backgroundColor: colors.primarySoft,
  },
  row: { flexDirection: 'row', gap: 14, alignItems: 'center', minHeight: 72 },
  rowBody: { flex: 1, justifyContent: 'center' },
  rowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  code: {
    fontFamily: fonts.uiBold,
    color: colors.navy,
    fontSize: 18,
    flex: 1,
  },
  itemName: {
    fontFamily: fonts.ui,
    color: colors.text,
    fontSize: 15,
    marginTop: 6,
    marginBottom: 4,
    lineHeight: 20,
  },
  meta: {
    fontFamily: fonts.ui,
    color: colors.muted,
    fontSize: 13,
  },
});
