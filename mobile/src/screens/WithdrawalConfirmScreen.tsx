import React, { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { withdrawalApi } from '../api/endpoints';
import { getErrorMessage } from '../api/client';
import { Badge, Button, Card, ErrorState, Muted, Screen, Subtitle } from '../components/ui';
import { downloadAndSharePdf } from '../utils/downloadPdf';
import { colors } from '../theme/tokens';

function DetailRow({ label, value }: { label: string; value?: string | number | null }) {
  if (value === undefined || value === null || value === '') return null;
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: 12,
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderBottomColor: colors.borderSoft,
      }}
    >
      <Text style={{ color: colors.muted, fontWeight: '600', fontSize: 13, flex: 1 }}>{label}</Text>
      <Text style={{ color: colors.navy, fontWeight: '700', fontSize: 14, flex: 1.3, textAlign: 'right' }}>
        {String(value)}
      </Text>
    </View>
  );
}

export default function WithdrawalConfirmScreen({ route }: any) {
  const id = route?.params?.id;
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  const [pdfMsg, setPdfMsg] = useState('');
  const [pdfLoading, setPdfLoading] = useState(false);

  useEffect(() => {
    if (!id) return;
    withdrawalApi
      .detail(id)
      .then((r) => setData(r.data))
      .catch((e) => setError(getErrorMessage(e)));
  }, [id]);

  if (!id) return <ErrorState message="Missing withdrawal id" />;

  const sharePdf = async () => {
    setPdfMsg('');
    setPdfLoading(true);
    try {
      await downloadAndSharePdf(withdrawalApi.pdfPath(id), `withdrawal-${id}.pdf`);
      setPdfMsg('PDF ready to share / save');
    } catch (e) {
      setPdfMsg(getErrorMessage(e));
    } finally {
      setPdfLoading(false);
    }
  };

  return (
    <Screen style={{ padding: 0 }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
        {data ? (
          <>
            <Card>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Subtitle>Withdrawal #{data.id}</Subtitle>
                <Badge label="COMPLETED" tone="success" />
              </View>
              <Muted>This stock cannot be withdrawn again.</Muted>
            </Card>

            <Card>
              <Subtitle>Performed by</Subtitle>
              <DetailRow label="Name" value={data.user_name} />
              <DetailRow label="Username" value={data.user_username} />
              <DetailRow label="Role" value={data.user_role} />
              <DetailRow label="Employee ID" value={data.user_employee_id || '—'} />
              <DetailRow label="Email" value={data.user_email || '—'} />
              <DetailRow label="Date / time" value={String(data.created_at).replace('T', ' ').slice(0, 19)} />
            </Card>

            <Card>
              <Subtitle>Withdrawal details</Subtitle>
              <DetailRow label="Purpose" value={data.purpose} />
              <DetailRow label="Reference" value={data.reference || '—'} />
              <DetailRow label="Notes" value={data.notes || '—'} />
            </Card>

            <Card>
              <Subtitle>Lines</Subtitle>
              {(data.lines || []).map((l: any) => {
                const loc = l.previous_location || {};
                const locStr = loc.warehouse
                  ? `${loc.warehouse}/${loc.rack}/${loc.shelf}/${loc.position}`
                  : '—';
                return (
                  <View key={l.id} style={{ marginBottom: 12 }}>
                    <Text style={{ fontWeight: '800', color: colors.navy }}>
                      {l.batch_code || l.unit_code}
                    </Text>
                    <Muted>
                      {l.item_code ? `${l.item_code} — ` : ''}
                      {l.item_name || 'Item'}
                    </Muted>
                    <DetailRow label="Quantity" value={l.quantity} />
                    <DetailRow label="From location" value={locStr} />
                    <DetailRow
                      label="Age order"
                      value={
                        l.fifo_override
                          ? `Override · ${l.override_reason || '—'}`
                          : 'Older stock used first'
                      }
                    />
                  </View>
                );
              })}
            </Card>

            <Button label="Download / share PDF receipt" onPress={sharePdf} loading={pdfLoading} />
            {pdfMsg ? <Muted>{pdfMsg}</Muted> : null}
          </>
        ) : !error ? (
          <Muted>Loading confirmation…</Muted>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
