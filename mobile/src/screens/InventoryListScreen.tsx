import React, { useCallback, useMemo, useRef, useState } from 'react';
import { FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
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
  LoadingState,
  Muted,
  Screen,
  SearchInput,
  SectionLabel,
  TextAction,
} from '../components/ui';
import { PageHeader } from '../components/PageHeader';
import { EmptyBoxIcon } from '../components/icons';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useTabScrollPadding } from '../hooks/useTabScrollPadding';
import { colors, fonts, radius, spacing } from '../theme/tokens';
import { canAccess } from '../utils/roles';

type StockType = '' | 'BATCH' | 'UNIT';
type TestingFilter = '' | 'PENDING' | 'PASSED' | 'FAILED';
type AllocatedFilter = '' | '1' | '0';

type FilterState = {
  stockType: StockType;
  testing: TestingFilter;
  allocated: AllocatedFilter;
};

const EMPTY_FILTERS: FilterState = { stockType: '', testing: '', allocated: '' };

function summarizeFilters(f: FilterState) {
  const parts: string[] = [];
  if (f.stockType === 'BATCH') parts.push('Batch');
  if (f.stockType === 'UNIT') parts.push('Unit');
  if (f.testing) parts.push(f.testing.charAt(0) + f.testing.slice(1).toLowerCase());
  if (f.allocated === '1') parts.push('On rack');
  if (f.allocated === '0') parts.push('Not allocated');
  return parts.join(' · ');
}

export default function InventoryListScreen() {
  const navigation = useNavigation<any>();
  const { user } = useAuth();
  const canManage = canAccess(user?.role, 'manageMasterData');
  const scrollPad = useTabScrollPadding(28);
  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q, 300);
  /** Filters currently applied to the list / API. */
  const [applied, setApplied] = useState<FilterState>(EMPTY_FILTERS);
  /** Draft while the filter panel is open — applied only on Apply. */
  const [draft, setDraft] = useState<FilterState>(EMPTY_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const hasRows = useRef(false);

  const filtersActive = Boolean(applied.stockType || applied.testing || applied.allocated);
  const activeSummary = useMemo(() => summarizeFilters(applied), [applied]);

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
    setApplied(draft);
    setFiltersOpen(false);
  };

  const clearDraft = () => setDraft(EMPTY_FILTERS);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      const soft = hasRows.current;
      (async () => {
        setError('');
        if (soft) setSearching(true);
        else setLoading(true);
        try {
          const { data } = await inventoryApi.list({
            q: debouncedQ.trim() || undefined,
            type: applied.stockType || undefined,
            testing_status: applied.testing || undefined,
            allocated: applied.allocated || undefined,
          });
          if (cancelled) return;
          const batches = (data.batches || []).map((b: any) => ({ kind: 'BATCH', ...b }));
          const units = (data.units || []).map((u: any) => ({ kind: 'UNIT', ...u }));
          setRows([...batches, ...units]);
          hasRows.current = true;
        } catch (e) {
          if (!cancelled) setError(getErrorMessage(e));
        } finally {
          if (!cancelled) {
            setLoading(false);
            setSearching(false);
          }
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [debouncedQ, applied.stockType, applied.testing, applied.allocated])
  );

  if (loading && !rows.length) return <LoadingState />;
  if (error && !rows.length) {
    return (
      <ErrorState
        message={error}
        onRetry={() => {
          hasRows.current = false;
          setLoading(true);
          setApplied((a) => ({ ...a }));
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
            <Text style={styles.filterTitle}>Filters</Text>
            {draft.stockType || draft.testing || draft.allocated ? (
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
              { value: '1', label: 'On rack' },
              { value: '0', label: 'Not allocated' },
            ]}
          />
          <FormActions primaryLabel="Apply" onPrimary={applyFilters} onCancel={closeFilters} />
        </Card>
      ) : filtersActive ? (
        <View style={styles.activePill}>
          <Text style={styles.activePillText}>{activeSummary}</Text>
          <TextAction
            label="Clear"
            tone="muted"
            onPress={() => setApplied(EMPTY_FILTERS)}
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
      <FlatList
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
            <Card>
              <View style={styles.row}>
                {item.item?.image_url ? (
                  <Image source={{ uri: item.item.image_url }} style={styles.thumb} />
                ) : (
                  <View style={styles.thumbPlaceholder}>
                    <EmptyBoxIcon size={28} />
                  </View>
                )}
                <View style={styles.rowBody}>
                  <View style={styles.rowTop}>
                    <Text style={styles.code} numberOfLines={1}>
                      {item.kind === 'BATCH' ? item.batch_code : item.unit_code}
                    </Text>
                    <Badge label={item.kind} tone={item.kind === 'BATCH' ? 'primary' : 'success'} />
                  </View>
                  <Text style={styles.itemName} numberOfLines={1}>
                    {item.item?.name}
                  </Text>
                  <Muted>
                    {item.kind === 'BATCH'
                      ? `Available ${item.available_qty} · QA ${item.testing_status || '—'}`
                      : `Status ${item.status} · QA ${item.testing_status || '—'}`}
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
  row: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  thumb: {
    width: 56,
    height: 56,
    borderRadius: 14,
    backgroundColor: colors.surfaceMuted,
  },
  thumbPlaceholder: {
    width: 56,
    height: 56,
    borderRadius: 14,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: { flex: 1 },
  rowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  code: {
    fontFamily: fonts.uiBold,
    color: colors.navy,
    fontSize: 16,
    flex: 1,
  },
  itemName: {
    fontFamily: fonts.ui,
    color: colors.text,
    marginTop: 4,
    marginBottom: 2,
  },
});
