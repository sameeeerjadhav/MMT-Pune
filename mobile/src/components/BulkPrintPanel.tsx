import React, { useEffect, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { grnApi, printersApi } from '../api/endpoints';
import { getErrorMessage } from '../api/client';
import { sendLabelToPrinter } from '../services/hardware/printer';
import { colors, fonts } from '../theme/tokens';
import { Badge, Button, Card, Muted } from './ui';
import type { Printer } from './PrinterManager';

const PAGE_SIZE = 40;

/**
 * Prints every barcode label on a GRN in pages: the server builds the printer commands for a
 * page of labels, the phone sends them to the Wi-Fi printer, then the next page, until done.
 * If it stops part-way (printer off, Wi-Fi), it can resume from where it stopped.
 */
export function BulkPrintPanel({ grnId, grnNumber }: { grnId: number; grnNumber: string }) {
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [resumeAt, setResumeAt] = useState(0);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    printersApi
      .list(true)
      .then((res) => {
        if (!alive) return;
        const list: Printer[] = res.data;
        setPrinters(list);
        setSelectedId((current) => current ?? list[0]?.id ?? null);
      })
      .catch((e) => alive && setError(getErrorMessage(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const selected = printers.find((p) => p.id === selectedId) ?? null;

  const run = async (startOffset: number) => {
    if (!selected) return;
    setRunning(true);
    setError('');
    setMessage('');
    let offset: number | null = startOffset;
    let printed = startOffset;
    let total = 0;
    let logFailed = false;
    let missing = 0;
    try {
      while (offset !== null) {
        const res = await grnApi.printCommands(grnId, selected.id, offset, PAGE_SIZE);
        const page = res.data;
        total = page.total;
        missing = page.missing_barcodes || 0;
        if (page.count > 0) {
          try {
            await sendLabelToPrinter(selected, page.commands);
          } catch (e) {
            setResumeAt(offset);
            setProgress({ done: printed, total });
            setError(`${(e as Error).message} Printed ${printed} of ${total} labels.`);
            return;
          }
          try {
            await grnApi.printLog(grnId, selected.name, page.barcode_values);
          } catch {
            logFailed = true; // labels did print; only the audit record is missing
          }
          printed += page.count;
        }
        setProgress({ done: printed, total });
        offset = page.next_offset;
      }
      setResumeAt(0);
      setMessage(
        total === 0
          ? 'This GRN has no barcodes yet. Generate barcodes first.'
          : `Sent ${total} label${total === 1 ? '' : 's'} to ${selected.name}.` +
              (logFailed ? ' (some print-log entries were not saved)' : '') +
              (missing ? ` ${missing} item(s) still have no barcode.` : '')
      );
    } catch (e) {
      setResumeAt(offset ?? 0);
      setError(getErrorMessage(e));
    } finally {
      setRunning(false);
    }
  };

  const confirmAll = () =>
    Alert.alert(
      'Print all labels?',
      `Every label on ${grnNumber} will be sent to ${selected?.name}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Print', onPress: () => void run(0) },
      ]
    );

  return (
    <Card>
      <Text style={{ fontFamily: fonts.uiBold, color: colors.navy, marginBottom: 4 }}>Print all labels</Text>
      {loading ? <Muted>Loading printers…</Muted> : null}
      {!loading && printers.length === 0 ? (
        <Muted>No active printer set up. An admin or supervisor can add one in Settings.</Muted>
      ) : null}

      {printers.length > 1 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
          {printers.map((p) => (
            <Pressable key={p.id} onPress={() => !running && setSelectedId(p.id)}>
              <Badge label={p.name} tone={p.id === selectedId ? 'primary' : 'warning'} />
            </Pressable>
          ))}
        </View>
      ) : null}

      {selected ? (
        <>
          <Muted>
            {selected.name} · {selected.label_width_mm}×{selected.label_height_mm} mm · {selected.language}
          </Muted>
          <View style={{ marginTop: 8, gap: 8 }}>
            {resumeAt > 0 && !running ? (
              <Button label={`Resume from label ${resumeAt + 1}`} onPress={() => void run(resumeAt)} />
            ) : null}
            <Button
              label={resumeAt > 0 ? 'Start again from label 1' : 'Print all labels'}
              variant={resumeAt > 0 ? 'secondary' : 'primary'}
              onPress={confirmAll}
              loading={running}
            />
          </View>
        </>
      ) : null}

      {progress && (running || resumeAt > 0) ? (
        <Muted>
          {progress.done} of {progress.total} sent
        </Muted>
      ) : null}
      {message ? <Muted>{message}</Muted> : null}
      {error ? <Text style={{ color: colors.danger, marginTop: 6 }}>{error}</Text> : null}
    </Card>
  );
}
