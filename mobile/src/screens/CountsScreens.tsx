import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { countsApi, warehouseApi } from '../api/endpoints';
import { getErrorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useOfflineQueue } from '../context/OfflineQueueContext';
import { postOrQueue } from '../services/offlineQueue';
import { PageHeader } from '../components/PageHeader';
import { SyncStatusCard } from '../components/SyncStatusCard';
import { ClipboardIcon } from '../components/icons';
import {
  Badge,
  Button,
  Card,
  ErrorState,
  Input,
  Muted,
  Screen,
  SearchInput,
  SectionLabel,
  SelectList,
  SelectRow,
  Subtitle,
  TextAction,
} from '../components/ui';
import { DetailSkeleton } from '../components/Skeleton';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useTabScrollPadding } from '../hooks/useTabScrollPadding';
import { downloadAndShareFile } from '../utils/downloadFile';
import { canAccess } from '../utils/roles';
import { colors, fonts } from '../theme/tokens';

const STATUS_TONE: Record<string, 'primary' | 'success' | 'warning' | 'danger'> = {
  MATCH: 'success',
  MISSING: 'danger',
  SHORT: 'warning',
  OVER: 'warning',
  UNEXPECTED: 'danger',
};

const STATUS_LABEL: Record<string, string> = {
  MATCH: 'Match',
  MISSING: 'Missing',
  SHORT: 'Short',
  OVER: 'Over',
  UNEXPECTED: 'Not here',
};

const MAX_ROWS = 80;

function when(iso?: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleString() : '';
}

/* ------------------------------------------------------------------ list + start */

export function CountListScreen({ navigation }: any) {
  const scrollPad = useTabScrollPadding(28);
  const [counts, setCounts] = useState<any[]>([]);
  const [racks, setRacks] = useState<any[]>([]);
  const [query, setQuery] = useState('');
  const debounced = useDebouncedValue(query, 250);
  const [rackId, setRackId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');

  const loadCounts = useCallback(async () => {
    try {
      const { data } = await countsApi.list();
      setCounts(data);
      setError('');
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadCounts();
    }, [loadCounts])
  );

  useEffect(() => {
    let alive = true;
    warehouseApi
      .racks({ q: debounced.trim() || undefined })
      .then((res) => {
        if (alive) setRacks(res.data);
      })
      .catch(() => {
        if (alive) setRacks([]);
      });
    return () => {
      alive = false;
    };
  }, [debounced]);

  const start = async () => {
    if (!rackId) return;
    setStarting(true);
    setError('');
    try {
      const { data } = await countsApi.start(rackId);
      setRackId(null);
      navigation.navigate('CountSession', { id: data.id });
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setStarting(false);
    }
  };

  const open = counts.filter((c) => c.status === 'OPEN');
  const done = counts.filter((c) => c.status === 'SUBMITTED');

  const renderRow = (c: any) => (
    <Pressable
      key={c.id}
      onPress={() => navigation.navigate('CountSession', { id: c.id })}
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
    >
      <Card>
        <View style={styles.rowBetween}>
          <Text style={styles.rowTitle}>
            Rack {c.rack.code}
            {c.rack.name ? ` · ${c.rack.name}` : ''}
          </Text>
          <Badge label={c.status === 'OPEN' ? 'In progress' : 'Submitted'} tone={c.status === 'OPEN' ? 'warning' : 'primary'} />
        </View>
        <Muted>
          #{c.id} · {c.line_count} scanned · started by {c.started_by || '-'} · {when(c.started_at)}
        </Muted>
        {c.status === 'SUBMITTED' ? (
          <Text style={{ color: c.differences ? colors.danger : colors.success, fontFamily: fonts.uiSemi, marginTop: 2 }}>
            {c.differences ? `${c.differences} difference${c.differences === 1 ? '' : 's'} found` : 'No differences'}
          </Text>
        ) : null}
      </Card>
    </Pressable>
  );

  return (
    <Screen style={{ padding: 0 }}>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: scrollPad }}
        keyboardShouldPersistTaps="handled"
      >
        <PageHeader title="Stock counts" safeTop right={<ClipboardIcon size={22} color={colors.primaryDark} />} />
        <SyncStatusCard />

        <Card>
          <Subtitle>Start a count</Subtitle>
          <Muted>
            Pick a rack, scan everything physically on it, then submit. The app flags what differs from the system. It
            never changes stock by itself.
          </Muted>
          <View style={{ height: 8 }} />
          <SearchInput value={query} onChangeText={setQuery} placeholder="Find a rack" />
          <SelectList maxHeight={190} count={racks.length} emptyLabel="No racks found">
            {racks.map((r) => (
              <SelectRow
                key={r.id}
                label={`Rack ${r.code}`}
                subtitle={`${r.warehouse_code}${r.floor_code ? ` · floor ${r.floor_code}` : ''}${r.name ? ` · ${r.name}` : ''}`}
                selected={r.id === rackId}
                onPress={() => setRackId(r.id)}
              />
            ))}
          </SelectList>
          <View style={{ height: 8 }} />
          <Button label="Start or resume count" onPress={start} loading={starting} disabled={!rackId} />
        </Card>

        {error ? <Text style={{ color: colors.danger, marginVertical: 8 }}>{error}</Text> : null}

        {loading ? (
          <DetailSkeleton />
        ) : (
          <>
            <SectionLabel>In progress ({open.length})</SectionLabel>
            {open.length === 0 ? <Muted>No counts in progress.</Muted> : open.map(renderRow)}
            <SectionLabel>Recent submitted</SectionLabel>
            {done.length === 0 ? <Muted>Nothing submitted yet.</Muted> : done.map(renderRow)}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

/* ------------------------------------------------------------------ one count */

function VarianceRows({ rows }: { rows: any[] }) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? rows : rows.slice(0, MAX_ROWS);
  return (
    <>
      {visible.map((r, i) => (
        <View key={`${r.kind}-${r.code}-${i}`} style={styles.varRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>
              {r.code} <Text style={{ fontFamily: fonts.ui, color: colors.muted }}>· {r.item_name}</Text>
            </Text>
            <Muted>
              System {r.expected_qty} · counted {r.counted_qty}
              {r.difference !== '0' ? ` · diff ${Number(r.difference) > 0 ? '+' : ''}${r.difference}` : ''}
              {r.system_location ? ` · system: ${r.system_location}` : ''}
            </Muted>
          </View>
          <Badge label={STATUS_LABEL[r.status] || r.status} tone={STATUS_TONE[r.status] || 'primary'} />
        </View>
      ))}
      {rows.length > MAX_ROWS ? (
        <TextAction
          label={showAll ? 'Show fewer' : `Show all ${rows.length}`}
          onPress={() => setShowAll((v) => !v)}
          tone="muted"
        />
      ) : null}
    </>
  );
}

export function CountSessionScreen({ route, navigation }: any) {
  const id: number = route?.params?.id;
  const { user } = useAuth();
  const { jobs, syncVersion } = useOfflineQueue();
  const scrollPad = useTabScrollPadding(28);
  const [permission, requestPermission] = useCameraPermissions();
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [offlineNote, setOfflineNote] = useState(false);
  const [cameraOn, setCameraOn] = useState(true);
  const [manual, setManual] = useState('');
  const [pendingBatch, setPendingBatch] = useState<string | null>(null);
  const [qty, setQty] = useState('');
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'warn' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const lastScan = useRef<{ code: string; at: number }>({ code: '', at: 0 });
  const inFlight = useRef(false);
  const hasSession = useRef(false);

  const load = useCallback(async () => {
    try {
      const { data } = await countsApi.detail(id);
      hasSession.current = true;
      setSession(data);
      setError('');
      setOfflineNote(false);
    } catch (e) {
      // Keep what we already have on screen when only the connection is down.
      if (hasSession.current) setOfflineNote(true);
      else setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  // Reload when queued scans have just been sent.
  useEffect(() => {
    if (syncVersion > 0) void load();
  }, [syncVersion, load]);

  useEffect(() => {
    if (session?.rack?.code) navigation.setOptions({ title: `Count · Rack ${session.rack.code}` });
  }, [session?.rack?.code, navigation]);

  const queuedForThis = useMemo(
    () => jobs.filter((j) => j.type === 'count_scan' && j.meta?.sessionId === id),
    [jobs, id]
  );
  const waitingToSync = queuedForThis.filter((j) => j.status === 'pending').length;
  const rejected = queuedForThis.filter((j) => j.status === 'failed').length;

  const isOpen = session?.status === 'OPEN';

  const submitScan = async (code: string, quantity?: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setFeedback(null);
    try {
      const body: Record<string, unknown> = { barcode: code, scanned_at: new Date().toISOString() };
      if (quantity !== undefined) body.quantity = quantity;
      const res = await postOrQueue({
        type: 'count_scan',
        path: countsApi.scanPath(id),
        body,
        label: `Count #${id} · ${code}${quantity !== undefined ? ` × ${quantity}` : ''}`,
        meta: { sessionId: id },
      });
      setPendingBatch(null);
      setQty('');
      setManual('');
      if (res.queued) {
        setFeedback({ tone: 'warn', text: `No connection. ${code} saved on this phone and will sync automatically.` });
        return;
      }
      const { line, created, expected_here, system_location } = res.data;
      const name = `${line.code} · ${line.item_name}`;
      if (!expected_here) {
        setFeedback({
          tone: 'bad',
          text: `${name} is not on this rack. System location: ${system_location || 'unknown'}.`,
        });
      } else {
        setFeedback({
          tone: 'ok',
          text: `${name}${line.kind === 'BATCH' ? ` × ${line.quantity}` : ''}${created ? '' : ' (already counted, updated)'}`,
        });
      }
      await load();
    } catch (e) {
      const message = getErrorMessage(e);
      // An unlabelled code turned out to be a batch: ask for the counted quantity.
      if (quantity === undefined && /quantity/i.test(message)) {
        setPendingBatch(code);
      } else {
        setFeedback({ tone: 'bad', text: message });
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const handleCode = (raw: string) => {
    const code = raw.trim();
    if (!code || !isOpen) return;
    const now = Date.now();
    if (lastScan.current.code === code && now - lastScan.current.at < 2500) return; // camera re-reads
    lastScan.current = { code, at: now };
    // Batch labels start with "B": the counted quantity is typed in. Unit labels count as 1.
    if (code.toUpperCase().startsWith('B')) {
      setFeedback(null);
      setPendingBatch(code);
      setQty('');
    } else {
      void submitScan(code);
    }
  };

  const undo = (line: any) => {
    Alert.alert('Remove this scan?', `${line.code} · ${line.item_name}`, [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await countsApi.removeLine(id, line.id);
            await load();
          } catch (e) {
            setFeedback({ tone: 'bad', text: getErrorMessage(e) });
          }
        },
      },
    ]);
  };

  const submit = () => {
    const differences = session?.variance?.differences ?? 0;
    Alert.alert(
      'Submit this count?',
      `${differences} difference${differences === 1 ? '' : 's'} will be recorded. Items you did not scan count as missing. ` +
        'Stock is not changed automatically, and a submitted count cannot be edited.',
      [
        { text: 'Keep counting', style: 'cancel' },
        {
          text: 'Submit',
          onPress: async () => {
            setSubmitting(true);
            setFeedback(null);
            try {
              await countsApi.submit(id);
              await load();
            } catch (e) {
              setFeedback({ tone: 'bad', text: getErrorMessage(e) });
            } finally {
              setSubmitting(false);
            }
          },
        },
      ]
    );
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      await downloadAndShareFile(countsApi.varianceCsvPath(id), `count-${id}-rack-${session?.rack?.code}.csv`);
    } catch (e) {
      setFeedback({ tone: 'bad', text: getErrorMessage(e) });
    } finally {
      setExporting(false);
    }
  };

  if (!id) return <ErrorState message="Missing count id" />;
  if (loading && !session) return <DetailSkeleton />;
  if (error && !session) return <ErrorState message={error} onRetry={load} />;
  if (!session) return <ErrorState message="Count not found" onRetry={load} />;

  const variance = session.variance || { counts: {}, rows: [], differences: 0 };
  const counts = variance.counts || {};
  const feedbackColor = feedback?.tone === 'ok' ? colors.success : feedback?.tone === 'warn' ? colors.warning : colors.danger;

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: scrollPad }} keyboardShouldPersistTaps="handled">
        <Card>
          <View style={styles.rowBetween}>
            <Text style={styles.rowTitle}>
              Rack {session.rack.code}
              {session.rack.name ? ` · ${session.rack.name}` : ''}
            </Text>
            <Badge label={isOpen ? 'In progress' : 'Submitted'} tone={isOpen ? 'warning' : 'primary'} />
          </View>
          <Muted>
            {session.rack.warehouse_code} · started by {session.started_by || '-'} · {when(session.started_at)}
          </Muted>
          {!isOpen ? (
            <Muted>
              Submitted by {session.submitted_by || '-'} · {when(session.submitted_at)}
            </Muted>
          ) : null}
        </Card>

        {offlineNote ? <Muted>Offline: showing the last loaded results.</Muted> : null}
        <SyncStatusCard />
        {rejected > 0 ? (
          <Text style={{ color: colors.danger, marginBottom: 8 }}>
            {rejected} scan(s) for this count were rejected. Open Settings or More to review them.
          </Text>
        ) : null}

        {isOpen ? (
          <>
            {permission?.granted && cameraOn ? (
              <View style={styles.camera}>
                <CameraView
                  style={{ flex: 1 }}
                  barcodeScannerSettings={{ barcodeTypes: ['code128', 'qr', 'ean13'] }}
                  onBarcodeScanned={busy || pendingBatch ? undefined : ({ data }) => handleCode(data)}
                />
              </View>
            ) : (
              <Card>
                <Muted>{permission?.granted ? 'Camera is off.' : 'Camera permission is needed to scan.'}</Muted>
                {!permission?.granted ? (
                  <Button label="Enable camera" onPress={requestPermission} />
                ) : (
                  <Button label="Turn camera on" variant="secondary" onPress={() => setCameraOn(true)} />
                )}
              </Card>
            )}
            {permission?.granted && cameraOn ? (
              <TextAction label="Turn camera off" tone="muted" onPress={() => setCameraOn(false)} />
            ) : null}

            {pendingBatch ? (
              <Card style={{ borderColor: colors.primary, borderWidth: 1 }}>
                <Subtitle>Batch {pendingBatch}</Subtitle>
                <Muted>Count what is physically on the rack and enter the total quantity.</Muted>
                <Input
                  label="Counted quantity"
                  value={qty}
                  onChangeText={setQty}
                  keyboardType="decimal-pad"
                  placeholder="e.g. 120"
                  autoFocus
                />
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Button
                      label="Cancel"
                      variant="secondary"
                      onPress={() => {
                        setPendingBatch(null);
                        setQty('');
                      }}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button
                      label="Add"
                      loading={busy}
                      disabled={!qty.trim() || !(Number(qty) > 0)}
                      onPress={() => void submitScan(pendingBatch, qty.trim())}
                    />
                  </View>
                </View>
              </Card>
            ) : (
              <>
                <Input
                  placeholder="Type or paste a barcode"
                  value={manual}
                  onChangeText={setManual}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  onSubmitEditing={() => handleCode(manual)}
                />
                <Button label="Add barcode" variant="secondary" onPress={() => handleCode(manual)} loading={busy} />
              </>
            )}
          </>
        ) : null}

        {feedback ? (
          <Text style={{ color: feedbackColor, fontFamily: fonts.uiSemi, marginVertical: 8 }}>{feedback.text}</Text>
        ) : null}

        <SectionLabel>{isOpen ? 'Differences so far' : 'Result'}</SectionLabel>
        <Card>
          <View style={styles.chipRow}>
            {['MISSING', 'SHORT', 'OVER', 'UNEXPECTED', 'MATCH'].map((s) => (
              <View key={s} style={styles.chip}>
                <Text style={[styles.chipNum, { color: counts[s] && s !== 'MATCH' ? colors.danger : colors.navy }]}>
                  {counts[s] ?? 0}
                </Text>
                <Text style={styles.chipLabel}>{STATUS_LABEL[s]}</Text>
              </View>
            ))}
          </View>
          {isOpen ? <Muted>Items you have not scanned yet show as missing until you scan them.</Muted> : null}
        </Card>
        {variance.rows?.length ? (
          <Card>
            <VarianceRows rows={variance.rows} />
          </Card>
        ) : (
          <Muted>Nothing on this rack in the system, and nothing scanned yet.</Muted>
        )}

        {session.lines?.length ? (
          <>
            <SectionLabel>Scanned ({session.lines.length})</SectionLabel>
            <Card>
              {session.lines.map((l: any) => (
                <View key={l.id} style={styles.varRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>
                      {l.code} <Text style={{ fontFamily: fonts.ui, color: colors.muted }}>· {l.item_name}</Text>
                    </Text>
                    <Muted>
                      {l.kind === 'BATCH' ? `Counted ${l.quantity}` : 'Unit'} · {when(l.scanned_at)}
                    </Muted>
                  </View>
                  {isOpen ? <TextAction label="Remove" tone="danger" onPress={() => undo(l)} /> : null}
                </View>
              ))}
            </Card>
          </>
        ) : null}

        {queuedForThis.length > 0 ? (
          <>
            <SectionLabel>Saved offline ({queuedForThis.length})</SectionLabel>
            <Card>
              {queuedForThis.map((j) => (
                <View key={j.id} style={styles.varRow}>
                  <Text style={[styles.rowTitle, { flex: 1 }]}>{j.label}</Text>
                  <Badge label={j.status === 'failed' ? 'Rejected' : 'Waiting'} tone={j.status === 'failed' ? 'danger' : 'warning'} />
                </View>
              ))}
            </Card>
          </>
        ) : null}

        {isOpen ? (
          <View style={{ marginTop: 12 }}>
            <Button
              label="Submit count"
              variant="success"
              onPress={submit}
              loading={submitting}
              disabled={waitingToSync > 0}
            />
            {waitingToSync > 0 ? (
              <Muted>Wait until the {waitingToSync} saved scan(s) have synced, then submit.</Muted>
            ) : null}
          </View>
        ) : canAccess(user?.role, 'reports') ? (
          <View style={{ marginTop: 12 }}>
            <Button label="Share variance CSV" variant="secondary" onPress={exportCsv} loading={exporting} />
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  rowTitle: { fontFamily: fonts.uiBold, color: colors.navy, fontSize: 15, flexShrink: 1 },
  varRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSoft,
  },
  camera: { height: 220, borderRadius: 16, overflow: 'hidden', marginBottom: 8 },
  chipRow: { flexDirection: 'row', justifyContent: 'space-between' },
  chip: { alignItems: 'center', flex: 1 },
  chipNum: { fontFamily: fonts.display, fontSize: 22 },
  chipLabel: { color: colors.muted, fontSize: 11 },
});
