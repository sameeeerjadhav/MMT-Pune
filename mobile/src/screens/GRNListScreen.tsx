import React, { useCallback, useRef, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { grnApi } from '../api/endpoints';
import { getErrorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { DocIcon } from '../components/icons';
import { Button, Card, ErrorState, LoadingState, Muted, Screen, SearchInput } from '../components/ui';
import { colors } from '../theme/tokens';
import { useTabScrollPadding } from '../hooks/useTabScrollPadding';
import { canAccess } from '../utils/roles';

export default function GRNListScreen() {
  const navigation = useNavigation<any>();
  const { user } = useAuth();
  const scrollPad = useTabScrollPadding(28);
  const canImport = canAccess(user?.role, 'grnImport');
  const [q, setQ] = useState('');
  const qRef = useRef(q);
  qRef.current = q;
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (query?: string) => {
    try {
      const { data } = await grnApi.list({ q: (query ?? qRef.current) || undefined });
      setRows(data);
      setError('');
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load();
    }, [load])
  );

  if (loading && !rows.length) return <LoadingState />;
  if (error && !rows.length) return <ErrorState message={error} onRetry={() => load()} />;

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <DocIcon size={22} color={colors.primaryDark} />
        <Muted>
          {canImport
            ? 'Supervisors and admins can import mock GRNs from M1/Workroom samples.'
            : 'View received goods. Import is limited to supervisors and admins.'}
        </Muted>
      </View>
      <SearchInput
        placeholder="Search GRN number, vendor, ref..."
        value={q}
        onChangeText={setQ}
        onSubmitEditing={() => load(q)}
        onClear={() => {
          setQ('');
          load('');
        }}
      />
      <Button label="Search" variant="secondary" onPress={() => load(q)} />
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
                {item.external_system} | {String(item.received_date).slice(0, 10)} | {item.vendor_name || 'No vendor'}
              </Muted>
            </Card>
          </Pressable>
        )}
      />
    </Screen>
  );
}
