import React, { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { reportsApi } from '../api/endpoints';
import { getErrorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { ChartIcon } from '../components/icons';
import { Button, Card, ErrorState, LoadingState, Muted, Screen, Subtitle } from '../components/ui';
import { colors } from '../theme/tokens';
import { useTabScrollPadding } from '../hooks/useTabScrollPadding';
import { canAccess } from '../utils/roles';

function Row({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ borderBottomWidth: 1, borderBottomColor: '#E5E7EB', paddingVertical: 8 }}>
      {children}
    </View>
  );
}

function renderReport(title: string, data: any) {
  if (!data) return null;

  if (title === 'Stock') {
    const batches = data.batches || [];
    const units = data.units || [];
    return (
      <Card>
        <Subtitle>Bulk batches ({batches.length})</Subtitle>
        {batches.slice(0, 25).map((b: any) => (
          <Row key={`b-${b.id}`}>
            <Text style={{ fontWeight: '600' }}>{b.batch_code}</Text>
            <Muted>
              {b.item__name} · avail {b.available_qty} / recv {b.received_qty}
            </Muted>
          </Row>
        ))}
        <Subtitle>Units ({units.length})</Subtitle>
        {units.slice(0, 25).map((u: any) => (
          <Row key={`u-${u.id}`}>
            <Text style={{ fontWeight: '600' }}>{u.unit_code}</Text>
            <Muted>
              {u.item__name} · {u.status}
            </Muted>
          </Row>
        ))}
      </Card>
    );
  }

  if (title === 'GRN') {
    const rows = Array.isArray(data) ? data : [];
    return (
      <Card>
        <Subtitle>GRNs ({rows.length})</Subtitle>
        {rows.map((g: any) => (
          <Row key={g.id}>
            <Text style={{ fontWeight: '600' }}>{g.grn_number}</Text>
            <Muted>
              {g.external_system} · {g.vendor__name || '—'} · {String(g.received_date).slice(0, 10)} · {g.status}
            </Muted>
          </Row>
        ))}
      </Card>
    );
  }

  if (title === 'Withdrawals') {
    const rows = Array.isArray(data) ? data : [];
    return (
      <Card>
        <Subtitle>Withdrawals ({rows.length})</Subtitle>
        {rows.map((w: any) => (
          <Row key={w.id}>
            <Text style={{ fontWeight: '600' }}>
              #{w.id} · {w.purpose}
            </Text>
            <Muted>
              By {w.user_name || w.user__username || '—'}
              {w.user_role ? ` (${w.user_role})` : ''}
              {w.user_employee_id ? ` · emp ${w.user_employee_id}` : ''}
            </Muted>
            <Muted>
              {String(w.created_at).replace('T', ' ').slice(0, 19)} · {w.reference || 'no ref'}
            </Muted>
            {(w.lines || []).slice(0, 3).map((l: any, idx: number) => (
              <Muted key={`${w.id}-l-${idx}`}>
                · {l.batch_code || l.unit_code} · {l.item_name || 'item'} · qty {l.quantity}
                {l.fifo_override ? ' · OVERRIDE' : ''}
              </Muted>
            ))}
          </Row>
        ))}
      </Card>
    );
  }

  if (title === 'Occupancy') {
    const rows = Array.isArray(data) ? data : [];
    return (
      <Card>
        <Subtitle>Occupied positions ({rows.length})</Subtitle>
        {rows.map((r: any, idx: number) => (
          <Row key={`${r.warehouse}-${r.rack}-${r.shelf}-${r.position}-${idx}`}>
            <Text style={{ fontWeight: '600' }}>
              {r.warehouse}/{r.rack}/{r.shelf}/{r.position}
            </Text>
            <Muted>
              {r.batch || r.unit || '—'} · qty {r.quantity ?? '—'}
            </Muted>
          </Row>
        ))}
      </Card>
    );
  }

  if (title === 'FIFO') {
    const rows = Array.isArray(data) ? data : data.alerts || [];
    return (
      <Card>
        <Subtitle>FIFO risk alerts ({rows.length})</Subtitle>
        {rows.length === 0 ? <Muted>No active FIFO conflicts</Muted> : null}
        {rows.map((a: any, idx: number) => (
          <Row key={`${a.newer_batch}-${idx}`}>
            <Text style={{ fontWeight: '600', color: colors.danger }}>{a.item}</Text>
            <Muted>
              Newer {a.newer_batch} ({String(a.newer_date).slice(0, 10)}) while older {a.older_batch} still available
            </Muted>
          </Row>
        ))}
      </Card>
    );
  }

  return (
    <Card>
      <Subtitle>{title}</Subtitle>
      <Muted>{JSON.stringify(data).slice(0, 800)}</Muted>
    </Card>
  );
}

export default function ReportsScreen() {
  const { user } = useAuth();
  const scrollPad = useTabScrollPadding(28);
  const [data, setData] = useState<any>(null);
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfMsg, setPdfMsg] = useState('');

  if (!canAccess(user?.role, 'reports')) {
    return <ErrorState message="Reports are limited to supervisors and admins." />;
  }

  const run = async (name: string, fn: () => Promise<any>) => {
    setError('');
    setPdfMsg('');
    setLoading(true);
    try {
      const res = await fn();
      setTitle(name);
      setData(res.data);
    } catch (e) {
      setError(getErrorMessage(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  const downloadWithdrawalsPdf = async () => {
    setPdfMsg('');
    setPdfLoading(true);
    try {
      const { downloadAndSharePdf } = await import('../utils/downloadPdf');
      await downloadAndSharePdf(reportsApi.withdrawalsPdfPath(), 'withdrawal-report.pdf');
      setPdfMsg('Withdrawal PDF ready to share / save');
      setTitle('Withdrawals');
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setPdfLoading(false);
    }
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: scrollPad }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <ChartIcon size={22} color={colors.primaryDark} />
          <Muted>Live aggregates from PostgreSQL via the API.</Muted>
        </View>
        <Button label="Current stock" onPress={() => run('Stock', reportsApi.stock)} />
        <Button label="GRN report" variant="secondary" onPress={() => run('GRN', reportsApi.grn)} />
        <Button label="Withdrawals" variant="secondary" onPress={() => run('Withdrawals', reportsApi.withdrawals)} />
        <Button
          label="Download withdrawals PDF"
          variant="secondary"
          loading={pdfLoading}
          onPress={downloadWithdrawalsPdf}
        />
        <Button label="Rack occupancy" variant="secondary" onPress={() => run('Occupancy', reportsApi.occupancy)} />
        <Button label="FIFO violations" variant="secondary" onPress={() => run('FIFO', reportsApi.fifo)} />
        {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
        {pdfMsg ? <Muted>{pdfMsg}</Muted> : null}
        {loading ? <LoadingState /> : renderReport(title, data)}
      </ScrollView>
    </Screen>
  );
}
