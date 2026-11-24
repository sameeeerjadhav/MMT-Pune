import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { barcodeApi, printersApi } from '../api/endpoints';
import { getErrorMessage } from '../api/client';
import { sendLabelToPrinter } from '../services/hardware/printer';
import { colors } from '../theme/tokens';
import { Badge, Button, Muted } from './ui';
import type { Printer } from './PrinterManager';

/**
 * Sends a batch / unit Code 128 label straight to a Wi-Fi label printer (ZPL or TSPL).
 * Commands are built by the backend from the printer profile; this component only transports them.
 */
export function PrintLabelPanel({ barcodeValue }: { barcodeValue: string }) {
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
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
      .catch((e) => {
        if (alive) setError(getErrorMessage(e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const selected = printers.find((p) => p.id === selectedId) ?? null;

  const print = async () => {
    if (!selected) return;
    setSending(true);
    setMessage('');
    setError('');
    let commands: string;
    try {
      const res = await barcodeApi.printCommands(barcodeValue, selected.id);
      commands = res.data.commands;
    } catch (e) {
      setError(getErrorMessage(e));
      setSending(false);
      return;
    }
    try {
      await sendLabelToPrinter(selected, commands);
    } catch (e) {
      setError((e as Error).message);
      setSending(false);
      return;
    }
    // Record the print. A logging failure should not hide that the label was sent.
    let logged = true;
    try {
      await barcodeApi.printLog(barcodeValue, { printer: selected.name, notes: 'wifi label print' });
    } catch {
      logged = false;
    }
    setMessage(`Label sent to ${selected.name}.${logged ? '' : ' (print log not saved)'}`);
    setSending(false);
  };

  return (
    <View style={{ marginTop: 8, marginBottom: 8 }}>
      <Text style={{ color: colors.navy, fontWeight: '700', marginBottom: 4 }}>Print on Wi-Fi printer</Text>
      {loading ? <Muted>Loading printers…</Muted> : null}
      {!loading && printers.length === 0 ? (
        <Muted>No active printer set up. An admin or supervisor can add one in Settings.</Muted>
      ) : null}

      {printers.length > 1 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
          {printers.map((p) => (
            <Pressable key={p.id} onPress={() => setSelectedId(p.id)}>
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
          <View style={{ marginTop: 8 }}>
            <Button label="Print label" onPress={print} loading={sending} />
          </View>
        </>
      ) : null}

      {message ? <Muted>{message}</Muted> : null}
      {error ? <Text style={{ color: colors.danger, marginTop: 6 }}>{error}</Text> : null}
    </View>
  );
}
