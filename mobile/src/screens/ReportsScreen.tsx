import React, { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { reportsApi } from '../api/endpoints';
import { getErrorMessage } from '../api/client';
import { Button, Card, Muted, Screen, Subtitle, Title } from '../components/ui';
import { colors } from '../theme/tokens';

export default function ReportsScreen() {
  const [data, setData] = useState<any>(null);
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');

  const run = async (name: string, fn: () => Promise<any>) => {
    setError('');
    try {
      const res = await fn();
      setTitle(name);
      setData(res.data);
    } catch (e) {
      setError(getErrorMessage(e));
    }
  };

  return (
    <Screen>
      <ScrollView>
        <Title>Reports</Title>
        <Button label="Current stock" onPress={() => run('Stock', reportsApi.stock)} />
        <Button label="GRN report" variant="secondary" onPress={() => run('GRN', reportsApi.grn)} />
        <Button label="Withdrawals" variant="secondary" onPress={() => run('Withdrawals', reportsApi.withdrawals)} />
        <Button label="Rack occupancy" variant="secondary" onPress={() => run('Occupancy', reportsApi.occupancy)} />
        <Button label="FIFO violations" variant="secondary" onPress={() => run('FIFO', reportsApi.fifo)} />
        {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
        {data ? (
          <Card>
            <Subtitle>{title}</Subtitle>
            <Muted>{JSON.stringify(data).slice(0, 1200)}...</Muted>
          </Card>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
