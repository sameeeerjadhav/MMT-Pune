import React, { useCallback, useState } from 'react';
import { FlatList, Pressable, Text } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { grnApi } from '../api/endpoints';
import { getErrorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Button, Card, ErrorState, LoadingState, Muted, Screen, Title } from '../components/ui';
import { canAccess } from '../utils/roles';

export default function GRNListScreen() {
  const navigation = useNavigation<any>();
  const { user } = useAuth();
  const canImport = canAccess(user?.role, 'grnImport');
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const { data } = await grnApi.list();
      setRows(data);
      setError('');
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

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  return (
    <Screen>
      <Title>GRN</Title>
      <Muted>
        {canImport
          ? 'Supervisors and admins can import mock GRNs from M1/Workroom samples.'
          : 'View received goods. Import is limited to supervisors and admins.'}
      </Muted>
      {canImport ? (
        <Button label="Import / Add Sample GRN" onPress={() => navigation.navigate('GRNImport')} />
      ) : null}
      <FlatList
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
