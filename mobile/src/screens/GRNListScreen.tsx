import React, { useCallback, useRef, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { grnApi } from '../api/endpoints';
import { getErrorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { DocIcon } from '../components/icons';
import { Button, Card, ErrorState, Muted, Screen, SearchInput } from '../components/ui';
import { ListSkeleton } from '../components/Skeleton';
import { PageHeader } from '../components/PageHeader';
import { colors } from '../theme/tokens';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useTabScrollPadding } from '../hooks/useTabScrollPadding';
import { canAccess } from '../utils/roles';

export default function GRNListScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { user } = useAuth();
  const scrollPad = useTabScrollPadding(28);
  const canImport = canAccess(user?.role, 'grnImport');
  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q, 160);
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const appliedSearchKey = useRef('');
  const hasRows = useRef(false);

  // Dashboard "Inbound GRN" deep-link (e.g. q=DRAFT).
  useFocusEffect(
    useCallback(() => {
      const nextQ = typeof route.params?.q === 'string' ? route.params.q.trim() : '';
      const key = `${nextQ}|${route.params?.focusSearch ?? ''}`;
      if (!route.params?.focusSearch && !nextQ) return;
      if (key === appliedSearchKey.current) return;
      appliedSearchKey.current = key;
      if (nextQ) setQ(nextQ);
    }, [route.params?.q, route.params?.focusSearch])
  );

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      const soft = hasRows.current;
      (async () => {
        setError('');
        if (soft) setSearching(true);
        else setLoading(true);
        try {
          const { data } = await grnApi.list({ q: debouncedQ.trim() || undefined });
          if (!cancelled) {
            setRows(Array.isArray(data) ? data : data.results || []);
            hasRows.current = true;
          }
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
    }, [debouncedQ, reloadKey])
  );

  if (loading && !rows.length) return <ListSkeleton rows={6} titleWidth="22%" />;
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

  return (
    <Screen>
      <PageHeader
        title="GRN"
        safeTop
        right={<DocIcon size={22} color={colors.primaryDark} />}
      />
      <SearchInput
        placeholder="Search GRN number, vendor, ref..."
        value={q}
        onChangeText={setQ}
        searching={searching}
        onClear={() => setQ('')}
      />
      {canImport ? (
        <Button label="Import / Add Sample GRN" onPress={() => navigation.navigate('GRNImport')} />
      ) : null}
      {error ? <Text style={{ color: colors.danger, marginBottom: 8 }}>{error}</Text> : null}
      <FlatList
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: scrollPad }}
        data={rows}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => (
          <Pressable onPress={() => navigation.navigate('GRNDetail', { id: item.id })}>
            <Card>
              <Text style={{ fontWeight: '700' }}>{item.grn_number}</Text>
              <Muted>
                {item.external_system} | {String(item.received_date).slice(0, 10)} |{' '}
                {item.vendor_name || 'No vendor'}
              </Muted>
            </Card>
          </Pressable>
        )}
      />
    </Screen>
  );
}
