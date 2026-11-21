import React, { useCallback, useRef, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { inventoryApi } from '../api/endpoints';
import { getErrorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import {
  Badge,
  Button,
  Card,
  ErrorState,
  FormActions,
  InactiveDot,
  Input,
  LoadingState,
  ManageActionBar,
  Muted,
  Screen,
  SearchInput,
  Subtitle,
  TextAction,
} from '../components/ui';
import { useTabScrollPadding } from '../hooks/useTabScrollPadding';
import { colors } from '../theme/tokens';
import { canAccess } from '../utils/roles';

export default function ItemMasterScreen() {
  const { user } = useAuth();
  const canManage = canAccess(user?.role, 'manageMasterData');
  const scrollPad = useTabScrollPadding(28);
  const [q, setQ] = useState('');
  const qRef = useRef(q);
  qRef.current = q;
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<any | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    item_code: '',
    name: '',
    category_code_input: '',
    inventory_type: 'BULK',
    uom: 'EA',
    description: '',
    is_active: true,
  });

  const load = useCallback(
    async (query?: string) => {
      setError('');
      try {
        const { data } = await inventoryApi.items({
          q: (query ?? qRef.current) || undefined,
          include_inactive: canManage ? '1' : undefined,
        });
        setRows(data);
      } catch (e) {
        setError(getErrorMessage(e));
      } finally {
        setLoading(false);
      }
    },
    [canManage]
  );

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load();
    }, [load])
  );

  const openCreate = () => {
    setCreating(true);
    setEditing(null);
    setForm({
      item_code: '',
      name: '',
      category_code_input: '',
      inventory_type: 'BULK',
      uom: 'EA',
      description: '',
      is_active: true,
    });
  };

  const openEdit = (item: any) => {
    setCreating(false);
    setEditing(item);
    setForm({
      item_code: item.item_code || '',
      name: item.name || '',
      category_code_input: item.category_code || '',
      inventory_type: item.inventory_type || 'BULK',
      uom: item.uom || 'EA',
      description: item.description || '',
      is_active: item.is_active !== false,
    });
  };

  const closeForm = () => {
    setCreating(false);
    setEditing(null);
  };

  const save = async () => {
    if (!form.item_code.trim() || !form.name.trim()) {
      setError('Item code and name are required');
      return;
    }
    if (!editing && !form.category_code_input.trim()) {
      setError('Category code is required for new items');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload: any = {
        item_code: form.item_code.trim().toUpperCase(),
        name: form.name.trim(),
        inventory_type: form.inventory_type,
        uom: form.uom.trim() || 'EA',
        description: form.description,
        is_active: form.is_active,
      };
      if (form.category_code_input.trim()) {
        payload.category_code_input = form.category_code_input.trim().toUpperCase();
      }
      if (editing) {
        await inventoryApi.updateItem(editing.id, payload);
      } else {
        await inventoryApi.createItem(payload);
      }
      closeForm();
      await load();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (item: any) => {
    const next = item.is_active === false;
    setSaving(true);
    setError('');
    try {
      await inventoryApi.updateItem(item.id, { is_active: next });
      if (editing?.id === item.id) {
        setEditing({ ...editing, is_active: next });
        setForm((f) => ({ ...f, is_active: next }));
      }
      await load();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = (item: any) => {
    Alert.alert('Delete item?', `${item.item_code} — ${item.name}\nThis cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setSaving(true);
          setError('');
          try {
            await inventoryApi.deleteItem(item.id);
            if (editing?.id === item.id) closeForm();
            await load();
          } catch (e) {
            setError(getErrorMessage(e));
          } finally {
            setSaving(false);
          }
        },
      },
    ]);
  };

  if (loading && !rows.length) return <LoadingState />;
  if (error && !rows.length) return <ErrorState message={error} onRetry={() => load()} />;

  return (
    <Screen>
      <Muted>Master catalog used by GRNs and inventory.</Muted>
      <SearchInput
        placeholder="Search item code or name..."
        value={q}
        onChangeText={setQ}
        onSubmitEditing={() => load(q)}
        onClear={() => {
          setQ('');
          load('');
        }}
      />
      <Button label="Search" variant="secondary" onPress={() => load(q)} />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <Subtitle>Items ({rows.length})</Subtitle>
        {canManage ? (
          <TextAction
            label={creating && !editing ? 'Cancel' : '+ New item'}
            onPress={() => {
              if (creating && !editing) {
                closeForm();
                return;
              }
              openCreate();
            }}
          />
        ) : null}
      </View>

      {(creating || editing) && canManage ? (
        <Card>
          <Subtitle>{editing ? 'Edit item' : 'New item'}</Subtitle>
          <Input
            label="Item code"
            value={form.item_code}
            onChangeText={(t) => setForm((f) => ({ ...f, item_code: t }))}
            autoCapitalize="characters"
          />
          <Input label="Name" value={form.name} onChangeText={(t) => setForm((f) => ({ ...f, name: t }))} />
          <Input
            label="Category code"
            placeholder="e.g. FAST"
            value={form.category_code_input}
            onChangeText={(t) => setForm((f) => ({ ...f, category_code_input: t }))}
            autoCapitalize="characters"
          />
          <Input label="UOM" value={form.uom} onChangeText={(t) => setForm((f) => ({ ...f, uom: t }))} />
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 4 }}>
            <View style={{ flex: 1 }}>
              <Button
                label="BULK"
                variant={form.inventory_type === 'BULK' ? 'primary' : 'secondary'}
                onPress={() => setForm((f) => ({ ...f, inventory_type: 'BULK' }))}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                label="UNIT"
                variant={form.inventory_type === 'UNIT' ? 'primary' : 'secondary'}
                onPress={() => setForm((f) => ({ ...f, inventory_type: 'UNIT' }))}
              />
            </View>
          </View>
          <FormActions
            primaryLabel="Save"
            onPrimary={save}
            loading={saving}
            onCancel={closeForm}
            secondary={
              editing ? (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                    marginTop: 12,
                    paddingTop: 10,
                    borderTopWidth: StyleSheet.hairlineWidth,
                    borderTopColor: colors.borderSoft,
                  }}
                >
                  <TextAction
                    label={form.is_active ? 'Deactivate' : 'Activate'}
                    tone="muted"
                    onPress={() => toggleActive(editing)}
                    disabled={saving}
                  />
                  <Text style={{ color: colors.border }}>·</Text>
                  <TextAction
                    label="Delete item"
                    tone="danger"
                    onPress={() => confirmDelete(editing)}
                    disabled={saving}
                  />
                </View>
              ) : null
            }
          />
        </Card>
      ) : null}

      {error ? <Text style={{ color: colors.danger, marginBottom: 8 }}>{error}</Text> : null}

      <FlatList
        style={{ flex: 1 }}
        data={rows}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ paddingBottom: scrollPad }}
        renderItem={({ item }) => {
          const active = item.is_active !== false;
          return (
            <Card>
              <Pressable onPress={() => (canManage ? openEdit(item) : undefined)}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                  <InactiveDot active={active} size={9} />
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <Text style={{ fontWeight: '800', fontSize: 15, color: colors.navy }}>{item.item_code}</Text>
                      {!active ? <Badge label="Inactive" tone="danger" /> : null}
                      <Badge label={item.inventory_type} tone="primary" />
                    </View>
                    <Text style={{ color: colors.text, fontWeight: '600', marginTop: 2 }}>{item.name}</Text>
                    <Muted>
                      {item.category_name || item.category_code || 'No category'} · {item.uom}
                    </Muted>
                  </View>
                </View>
              </Pressable>
              {canManage ? (
                <ManageActionBar
                  isActive={active}
                  disabled={saving}
                  onEdit={() => openEdit(item)}
                  onToggleActive={() => toggleActive(item)}
                  onDelete={() => confirmDelete(item)}
                />
              ) : null}
            </Card>
          );
        }}
      />
    </Screen>
  );
}
