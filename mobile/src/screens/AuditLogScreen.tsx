import React, { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { auditApi } from '../api/endpoints';
import { getErrorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { ShieldIcon } from '../components/icons';
import { PageHeader } from '../components/PageHeader';
import { Badge, Button, Card, ErrorState, FilterChips, Muted, Screen, SearchInput } from '../components/ui';
import { ListSkeleton } from '../components/Skeleton';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useTabScrollPadding } from '../hooks/useTabScrollPadding';
import { colors, fonts } from '../theme/tokens';
import { canAccess } from '../utils/roles';

const PAGE_SIZE = 30;

function pretty(action: string) {
  return action.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

/** Compact "key: value" summary of the stored details (never the raw JSON blob). */
function summarize(details: unknown): string {
  if (!details || typeof details !== 'object') return '';
  const parts = Object.entries(details as Record<string, unknown>)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .slice(0, 5)
    .map(([k, v]) => {
      const text = typeof v === 'object' ? JSON.stringify(v) : String(v);
      return `${k.replace(/_/g, ' ')}: ${text.length > 60 ? `${text.slice(0, 60)}…` : text}`;
    });
  return parts.join(' · ');
}

function toneFor(action: string): 'primary' | 'success' | 'warning' | 'danger' {
  const a = action.toUpperCase();
  if (/DELETE|DEACTIVATE|FAIL|REJECT/.test(a)) return 'danger';
  if (/OVERRIDE|FIFO|TRANSFER|UPDATE|EDIT/.test(a)) return 'warning';
  if (/CREATE|ALLOCATE|SUBMIT|LOGIN|GENERATE/.test(a)) return 'success';
  return 'primary';
}

export default function AuditLogScreen() {
  const { user } = useAuth();
  const scrollPad = useTabScrollPadding(28);
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [actions, setActions] = useState<string[]>([]);
  const [action, setAction] = useState('');
  const [query, setQuery] = useState('');
  const debounced = useDebouncedValue(query, 350);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const seq = useRef(0);

  const fetchPage = useCallback(
    async (offset: number, mode: 'replace' | 'append' | 'refresh') => {
      const mine = ++seq.current;
      if (mode === 'append') setLoadingMore(true);
      else if (mode === 'refresh') setRefreshing(true);
      else setLoading(true);
      try {
        const { data } = await auditApi.list({
          limit: PAGE_SIZE,
          offset,
          action: action || undefined,
          q: debounced.trim() || undefined,
        });
        if (mine !== seq.current) return; // a newer filter/search superseded this request
        setRows((prev) => (mode === 'append' ? [...prev, ...data.results] : data.results));
        setTotal(data.count);
        setNextOffset(data.next_offset);
        if (data.facets?.actions) setActions(data.facets.actions);
        setError('');
      } catch (e) {
        if (mine === seq.current) setError(getErrorMessage(e));
      } finally {
        if (mine === seq.current) {
          setLoading(false);
          setLoadingMore(false);
          setRefreshing(false);
        }
      }
    },
    [action, debounced]
  );

  useEffect(() => {
    void fetchPage(0, 'replace');
  }, [fetchPage]);

  if (!canAccess(user?.role, 'auditLog')) {
    return <ErrorState message="The audit log is limited to administrators." />;
  }

  return (
    <Screen style={{ padding: 0 }}>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: scrollPad }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void fetchPage(0, 'refresh')} tintColor={colors.primary} />
        }
      >
        <PageHeader
          title="Audit log"
          subtitle={loading ? undefined : `${total} record${total === 1 ? '' : 's'}`}
          safeTop
          right={<ShieldIcon size={22} color={colors.primaryDark} />}
        />
        <SearchInput value={query} onChangeText={setQuery} placeholder="Search by user, action or record type" />
        {actions.length > 0 ? (
          <FilterChips
            value={action}
            onChange={setAction}
            options={[{ value: '', label: 'All' }, ...actions.map((a) => ({ value: a, label: pretty(a) }))]}
          />
        ) : null}

        {error ? <Text style={{ color: colors.danger, marginBottom: 8 }}>{error}</Text> : null}

        {loading ? (
          <ListSkeleton rows={6} showSearch={false} titleWidth="40%" />
        ) : rows.length === 0 ? (
          <Muted>No records match.</Muted>
        ) : (
          rows.map((r) => {
            const who = r.user ? r.user.name || r.user.username : 'System';
            const detail = summarize(r.details);
            return (
              <Card key={r.id}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <Badge label={pretty(r.action)} tone={toneFor(r.action)} />
                  <Muted>{new Date(r.created_at).toLocaleString()}</Muted>
                </View>
                <Text style={{ fontFamily: fonts.uiBold, color: colors.navy, marginTop: 6 }}>
                  {who}
                  {r.user?.role ? <Text style={{ fontFamily: fonts.ui, color: colors.muted }}> · {r.user.role}</Text> : null}
                </Text>
                {r.entity_type ? (
                  <Muted>
                    {r.entity_type}
                    {r.entity_id ? ` #${r.entity_id}` : ''}
                    {r.ip_address ? ` · ${r.ip_address}` : ''}
                  </Muted>
                ) : null}
                {detail ? <Muted>{detail}</Muted> : null}
              </Card>
            );
          })
        )}

        {nextOffset != null && !loading ? (
          <Button
            label={`Load more (${rows.length} of ${total})`}
            variant="secondary"
            loading={loadingMore}
            onPress={() => void fetchPage(nextOffset, 'append')}
          />
        ) : null}
      </ScrollView>
    </Screen>
  );
}
