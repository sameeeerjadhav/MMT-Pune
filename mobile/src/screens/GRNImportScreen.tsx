import React, { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { grnApi } from '../api/endpoints';
import { getErrorMessage } from '../api/client';
import { Button, Card, Input, Screen, Title, Muted } from '../components/ui';
import { colors } from '../theme/tokens';

const samplePayload = {
  grn_number: `GRN-DEMO-${Date.now().toString().slice(-6)}`,
  external_system: 'MOCK',
  external_ref: `MOCK-${Date.now()}`,
  vendor_code: 'V-ABC',
  vendor_name: 'ABC Industries',
  received_date: new Date().toISOString(),
  notes: 'Mock GRN import for demonstration',
  lines: [
    {
      item_code: 'STL-BOLT',
      item_name: 'Steel Bolt',
      category_code: 'FAST',
      received_qty: 25,
      uom: 'EA',
      testing_status: 'PASSED',
      classification: 'BULK',
    },
  ],
};

export default function GRNImportScreen({ navigation }: any) {
  const [json, setJson] = useState(JSON.stringify(samplePayload, null, 2));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const submit = async () => {
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const payload = JSON.parse(json);
      const { data } = await grnApi.import(payload);
      setSuccess(`Imported ${data.grn_number}`);
      navigation.replace('GRNDetail', { id: data.id });
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen>
      <ScrollView>
        <Title>Import GRN</Title>
        <Muted>Mock integration for M1/Workroom demo. Duplicate external refs are rejected.</Muted>
        <Card>
          <Input
            multiline
            value={json}
            onChangeText={setJson}
            style={{ minHeight: 280, textAlignVertical: 'top', fontFamily: 'monospace' }}
          />
          {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
          {success ? <Text style={{ color: colors.success }}>{success}</Text> : null}
          <Button label="Import sample GRN" onPress={submit} loading={loading} />
        </Card>
      </ScrollView>
    </Screen>
  );
}
