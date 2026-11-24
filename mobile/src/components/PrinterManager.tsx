import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { printersApi } from '../api/endpoints';
import { getErrorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { sendLabelToPrinter } from '../services/hardware/printer';
import { colors } from '../theme/tokens';
import { canAccess } from '../utils/roles';
import { Badge, Button, Card, FormActions, Input, Muted, Subtitle } from './ui';

export type Printer = {
  id: number;
  name: string;
  language: 'ZPL' | 'TSPL';
  host: string;
  port: number;
  label_width_mm: number;
  label_height_mm: number;
  dpi: 203 | 300;
  is_active: boolean;
};

/** Label-size presets (mm). "custom" lets admins enter any size within 10–200 mm. */
export const LABEL_SIZE_PRESETS = [
  { key: '50x25', label: '50 × 25 mm', width: 50, height: 25 },
  { key: '100x50', label: '100 × 50 mm', width: 100, height: 50 },
] as const;

type Form = {
  name: string;
  host: string;
  port: string;
  language: 'ZPL' | 'TSPL';
  sizeKey: string;
  width: string;
  height: string;
  dpi: 203 | 300;
  is_active: boolean;
};

const emptyForm: Form = {
  name: '',
  host: '',
  port: '9100',
  language: 'ZPL',
  sizeKey: '50x25',
  width: '50',
  height: '25',
  dpi: 203,
  is_active: true,
};

function formFromPrinter(p: Printer): Form {
  const preset = LABEL_SIZE_PRESETS.find((s) => s.width === p.label_width_mm && s.height === p.label_height_mm);
  return {
    name: p.name,
    host: p.host,
    port: String(p.port),
    language: p.language,
    sizeKey: preset ? preset.key : 'custom',
    width: String(p.label_width_mm),
    height: String(p.label_height_mm),
    dpi: p.dpi,
    is_active: p.is_active,
  };
}

function payloadFromForm(f: Form): { payload?: Record<string, unknown>; error?: string } {
  const name = f.name.trim();
  const host = f.host.trim();
  if (!name) return { error: 'Give the printer a name, e.g. Dock A Zebra.' };
  if (!host) return { error: 'Enter the printer IP address, e.g. 192.168.1.50.' };
  const preset = LABEL_SIZE_PRESETS.find((s) => s.key === f.sizeKey);
  const width = preset ? preset.width : Number(f.width);
  const height = preset ? preset.height : Number(f.height);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return { error: 'Label width and height must be numbers.' };
  return {
    payload: {
      name,
      host,
      port: Number(f.port) || 9100,
      language: f.language,
      label_width_mm: width,
      label_height_mm: height,
      dpi: f.dpi,
      is_active: f.is_active,
    },
  };
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress}>
      <Badge label={label} tone={selected ? 'primary' : 'warning'} />
    </Pressable>
  );
}

/** Settings section: list Wi-Fi label printers, test-print, and (admin / supervisor) add or edit them. */
export function PrinterManager() {
  const { user } = useAuth();
  const canManage = canAccess(user?.role, 'manageMasterData');
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [testingId, setTestingId] = useState<number | null>(null);
  const [editing, setEditing] = useState<Printer | 'new' | null>(null);
  const [form, setForm] = useState<Form>(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await printersApi.list();
      setPrinters(res.data);
      setError('');
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const startNew = () => {
    setForm(emptyForm);
    setEditing('new');
    setError('');
    setMessage('');
  };

  const startEdit = (p: Printer) => {
    setForm(formFromPrinter(p));
    setEditing(p);
    setError('');
    setMessage('');
  };

  const save = async () => {
    const result = payloadFromForm(form);
    if (!result.payload) {
      setError(result.error || 'Check the printer details.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      if (editing === 'new') {
        await printersApi.create(result.payload);
        setMessage('Printer added.');
      } else if (editing) {
        await printersApi.update(editing.id, result.payload);
        setMessage('Printer saved.');
      }
      setEditing(null);
      await load();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = (p: Printer) => {
    Alert.alert('Remove printer', `Remove ${p.name}? Existing print logs keep the printer name.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await printersApi.remove(p.id);
            setEditing(null);
            setMessage('Printer removed.');
            await load();
          } catch (e) {
            setError(getErrorMessage(e));
          }
        },
      },
    ]);
  };

  const testPrint = async (p: Printer) => {
    setTestingId(p.id);
    setError('');
    setMessage('');
    let commands: string;
    try {
      const res = await printersApi.testLabel(p.id);
      commands = res.data.commands;
    } catch (e) {
      setError(getErrorMessage(e));
      setTestingId(null);
      return;
    }
    try {
      await sendLabelToPrinter(p, commands);
      setMessage(`Test label sent to ${p.name}.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTestingId(null);
    }
  };

  const isCustomSize = form.sizeKey === 'custom';

  return (
    <Card>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <Subtitle>Label printers (Wi-Fi)</Subtitle>
        {canManage && editing === null ? (
          <Button label="Add printer" variant="secondary" onPress={startNew} />
        ) : null}
      </View>
      <Muted>Phone and printer must be on the same Wi-Fi. Printers listen on port 9100 (ZPL or TSPL).</Muted>

      {loading ? <Muted>Loading printers…</Muted> : null}
      {!loading && printers.length === 0 ? (
        <Muted>
          {canManage ? 'No printers yet. Tap Add printer to set one up.' : 'No printers set up yet. Ask an admin or supervisor.'}
        </Muted>
      ) : null}

      {printers.map((p) => (
        <View
          key={p.id}
          style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.borderSoft }}
        >
          <Text style={{ color: colors.navy, fontWeight: '700', fontSize: 15 }}>{p.name}</Text>
          <Muted>
            {p.host}:{p.port} · {p.language} · {p.label_width_mm}×{p.label_height_mm} mm · {p.dpi} dpi
          </Muted>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8, alignItems: 'center' }}>
            <Badge label={p.is_active ? 'Active' : 'Inactive'} tone={p.is_active ? 'success' : 'warning'} />
            <View style={{ flexGrow: 1, minWidth: 130 }}>
              <Button
                label="Test print"
                variant="secondary"
                disabled={!p.is_active || testingId !== null}
                loading={testingId === p.id}
                onPress={() => testPrint(p)}
              />
            </View>
            {canManage ? (
              <View style={{ flexGrow: 1, minWidth: 90 }}>
                <Button label="Edit" variant="ghost" onPress={() => startEdit(p)} />
              </View>
            ) : null}
          </View>
        </View>
      ))}

      {editing !== null && canManage ? (
        <View style={{ marginTop: 14 }}>
          <Subtitle>{editing === 'new' ? 'New printer' : `Edit ${editing.name}`}</Subtitle>
          <Input
            label="Name"
            placeholder="Dock A Zebra"
            value={form.name}
            onChangeText={(t) => setForm((f) => ({ ...f, name: t }))}
          />
          <Input
            label="IP address"
            placeholder="192.168.1.50"
            value={form.host}
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={(t) => setForm((f) => ({ ...f, host: t }))}
          />
          <Input
            label="Port"
            value={form.port}
            keyboardType="number-pad"
            onChangeText={(t) => setForm((f) => ({ ...f, port: t.replace(/[^0-9]/g, '') }))}
          />

          <Muted>Language</Muted>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
            <Chip label="ZPL (Zebra)" selected={form.language === 'ZPL'} onPress={() => setForm((f) => ({ ...f, language: 'ZPL' }))} />
            <Chip label="TSPL (TSC)" selected={form.language === 'TSPL'} onPress={() => setForm((f) => ({ ...f, language: 'TSPL' }))} />
          </View>

          <Muted>Label size</Muted>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
            {LABEL_SIZE_PRESETS.map((s) => (
              <Chip
                key={s.key}
                label={s.label}
                selected={form.sizeKey === s.key}
                onPress={() => setForm((f) => ({ ...f, sizeKey: s.key }))}
              />
            ))}
            <Chip label="Custom" selected={isCustomSize} onPress={() => setForm((f) => ({ ...f, sizeKey: 'custom' }))} />
          </View>
          {isCustomSize ? (
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Input
                  label="Width (mm)"
                  value={form.width}
                  keyboardType="number-pad"
                  onChangeText={(t) => setForm((f) => ({ ...f, width: t.replace(/[^0-9]/g, '') }))}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Input
                  label="Height (mm)"
                  value={form.height}
                  keyboardType="number-pad"
                  onChangeText={(t) => setForm((f) => ({ ...f, height: t.replace(/[^0-9]/g, '') }))}
                />
              </View>
            </View>
          ) : null}

          <Muted>Resolution</Muted>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
            <Chip label="203 dpi" selected={form.dpi === 203} onPress={() => setForm((f) => ({ ...f, dpi: 203 }))} />
            <Chip label="300 dpi" selected={form.dpi === 300} onPress={() => setForm((f) => ({ ...f, dpi: 300 }))} />
          </View>

          <Muted>Status</Muted>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
            <Chip label="Active" selected={form.is_active} onPress={() => setForm((f) => ({ ...f, is_active: true }))} />
            <Chip label="Inactive" selected={!form.is_active} onPress={() => setForm((f) => ({ ...f, is_active: false }))} />
          </View>

          <FormActions
            primaryLabel="Save"
            onPrimary={save}
            loading={saving}
            onCancel={() => setEditing(null)}
            secondary={
              editing !== 'new' && editing ? (
                <View style={{ marginTop: 10 }}>
                  <Button label="Remove printer" variant="danger" onPress={() => remove(editing)} />
                </View>
              ) : null
            }
          />
        </View>
      ) : null}

      {message ? <Muted>{message}</Muted> : null}
      {error ? <Text style={{ color: colors.danger, marginTop: 6 }}>{error}</Text> : null}
    </Card>
  );
}
