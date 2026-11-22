import React, { useCallback, useRef, useState } from 'react';
import { Alert, FlatList, Pressable, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { usersApi } from '../api/endpoints';
import { getErrorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import {
  Badge,
  Button,
  Card,
  ErrorState,
  FormActions,
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
import { canAccess, roleLabel } from '../utils/roles';

type StaffRole = 'SUPERVISOR' | 'WAREHOUSE_EMPLOYEE';

const ROLE_OPTIONS: { code: StaffRole; label: string }[] = [
  { code: 'SUPERVISOR', label: 'Supervisor' },
  { code: 'WAREHOUSE_EMPLOYEE', label: 'Warehouse Employee' },
];

export default function UsersScreen() {
  const { user } = useAuth();
  const canManage = canAccess(user?.role, 'manageUsers');
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
    username: '',
    password: '',
    first_name: '',
    last_name: '',
    email: '',
    employee_id: '',
    role: 'WAREHOUSE_EMPLOYEE' as StaffRole,
    is_active: true,
  });

  const load = useCallback(async (query?: string) => {
    setError('');
    try {
      const { data } = await usersApi.list({
        q: (query ?? qRef.current) || undefined,
        include_inactive: '1',
      });
      setRows(data);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load();
    }, [load])
  );

  if (!canManage) {
    return <ErrorState message="Only administrators can manage users." />;
  }

  const openCreate = () => {
    setCreating(true);
    setEditing(null);
    setForm({
      username: '',
      password: '',
      first_name: '',
      last_name: '',
      email: '',
      employee_id: '',
      role: 'WAREHOUSE_EMPLOYEE',
      is_active: true,
    });
  };

  const openEdit = (row: any) => {
    setCreating(false);
    setEditing(row);
    setForm({
      username: row.username || '',
      password: '',
      first_name: row.first_name || '',
      last_name: row.last_name || '',
      email: row.email || '',
      employee_id: row.employee_id || '',
      role: (row.role === 'SUPERVISOR' ? 'SUPERVISOR' : 'WAREHOUSE_EMPLOYEE') as StaffRole,
      is_active: row.is_active !== false,
    });
  };

  const save = async () => {
    if (creating && (!form.username.trim() || !form.password.trim())) {
      setError('Username and password are required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      if (creating) {
        await usersApi.create({
          username: form.username.trim(),
          password: form.password,
          first_name: form.first_name.trim(),
          last_name: form.last_name.trim(),
          email: form.email.trim(),
          employee_id: form.employee_id.trim(),
          role: form.role,
        });
      } else if (editing) {
        const payload: Record<string, unknown> = {
          first_name: form.first_name.trim(),
          last_name: form.last_name.trim(),
          email: form.email.trim(),
          employee_id: form.employee_id.trim(),
          role: form.role,
          is_active: form.is_active,
        };
        if (form.password.trim()) payload.password = form.password;
        await usersApi.update(editing.id, payload);
      }
      setCreating(false);
      setEditing(null);
      await load();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (row: any) => {
    setSaving(true);
    setError('');
    try {
      const nextActive = row.is_active === false;
      await usersApi.update(row.id, { is_active: nextActive });
      if (editing?.id === row.id) {
        setEditing({ ...editing, is_active: nextActive });
        setForm((f) => ({ ...f, is_active: nextActive }));
      }
      await load();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const confirmToggle = (row: any) => {
    const activate = row.is_active === false;
    Alert.alert(
      activate ? 'Activate user' : 'Deactivate user',
      activate
        ? `Activate ${row.username}? They will be able to sign in again.`
        : `Deactivate ${row.username}? They will not be able to sign in.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Confirm', onPress: () => toggleActive(row) },
      ]
    );
  };

  const removeUser = async (row: any) => {
    setSaving(true);
    setError('');
    try {
      await usersApi.delete(row.id);
      if (editing?.id === row.id) {
        setEditing(null);
        setCreating(false);
      }
      await load();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = (row: any) => {
    Alert.alert(
      'Delete user',
      `Permanently delete ${row.username}? Prefer Deactivate if they have withdrawal history.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => removeUser(row) },
      ]
    );
  };

  if (loading && !rows.length) return <LoadingState />;
  if (error && !rows.length) return <ErrorState message={error} onRetry={() => load()} />;

  const header = (
    <View>
      <Muted>
        Create, edit, activate, deactivate, or delete supervisors and warehouse employees.
      </Muted>
      <SearchInput
        placeholder="Search users..."
        value={q}
        onChangeText={setQ}
        onSubmitEditing={() => load(q)}
        onClear={() => {
          setQ('');
          load('');
        }}
      />
      <Button label="Search" variant="secondary" onPress={() => load(q)} />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Subtitle>Staff ({rows.length})</Subtitle>
        <TextAction
          label={creating && !editing ? 'Cancel' : '+ Add user'}
          onPress={() => {
            if (creating && !editing) {
              setCreating(false);
              return;
            }
            openCreate();
          }}
        />
      </View>

      {(creating || editing) && (
        <Card>
          <Subtitle>{editing ? `Edit ${editing.username}` : 'New user'}</Subtitle>
          {creating ? (
            <Input
              label="Username"
              value={form.username}
              onChangeText={(t) => setForm((f) => ({ ...f, username: t }))}
              autoCapitalize="none"
            />
          ) : (
            <Muted>Username: {form.username}</Muted>
          )}
          <Input
            label={creating ? 'Password' : 'New password (optional)'}
            value={form.password}
            onChangeText={(t) => setForm((f) => ({ ...f, password: t }))}
            secureTextEntry
          />
          <Input
            label="First name"
            value={form.first_name}
            onChangeText={(t) => setForm((f) => ({ ...f, first_name: t }))}
          />
          <Input
            label="Last name"
            value={form.last_name}
            onChangeText={(t) => setForm((f) => ({ ...f, last_name: t }))}
          />
          <Input
            label="Email"
            value={form.email}
            onChangeText={(t) => setForm((f) => ({ ...f, email: t }))}
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <Input
            label="Employee ID"
            value={form.employee_id}
            onChangeText={(t) => setForm((f) => ({ ...f, employee_id: t }))}
          />
          <Muted>Role</Muted>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
            {ROLE_OPTIONS.map((opt) => (
              <Pressable key={opt.code} onPress={() => setForm((f) => ({ ...f, role: opt.code }))}>
                <Badge label={opt.label} tone={form.role === opt.code ? 'primary' : 'warning'} />
              </Pressable>
            ))}
          </View>
          {editing ? (
            <>
              <Muted>Status</Muted>
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
                <Pressable onPress={() => setForm((f) => ({ ...f, is_active: true }))}>
                  <Badge label="Active" tone={form.is_active ? 'success' : 'warning'} />
                </Pressable>
                <Pressable onPress={() => setForm((f) => ({ ...f, is_active: false }))}>
                  <Badge label="Inactive" tone={!form.is_active ? 'danger' : 'warning'} />
                </Pressable>
              </View>
            </>
          ) : null}
          <FormActions
            primaryLabel="Save"
            onPrimary={save}
            loading={saving}
            onCancel={() => {
              setCreating(false);
              setEditing(null);
            }}
          />
        </Card>
      )}

      {error ? <Text style={{ color: colors.danger, marginBottom: 8 }}>{error}</Text> : null}
    </View>
  );

  return (
    <Screen>
      <FlatList
        style={{ flex: 1 }}
        data={rows}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ paddingBottom: scrollPad }}
        ListHeaderComponent={header}
        ListEmptyComponent={
          !loading ? <Muted>No supervisors or employees yet. Tap + Add user.</Muted> : null
        }
        renderItem={({ item }) => {
          const active = item.is_active !== false;
          return (
            <Card>
              <Pressable onPress={() => openEdit(item)} style={{ paddingVertical: 4 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: '800', color: colors.navy, fontSize: 15 }}>
                      {item.username}
                    </Text>
                    <Muted>
                      {[item.first_name, item.last_name].filter(Boolean).join(' ') || 'No name'}
                      {item.employee_id ? ` · ${item.employee_id}` : ''}
                    </Muted>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    <Badge
                      label={roleLabel(item.role)}
                      tone={item.role === 'SUPERVISOR' ? 'warning' : 'primary'}
                    />
                    {!active ? <Badge label="Inactive" tone="danger" /> : null}
                  </View>
                </View>
              </Pressable>
              <ManageActionBar
                isActive={active}
                disabled={saving}
                onEdit={() => openEdit(item)}
                onToggleActive={() => confirmToggle(item)}
                onDelete={() => confirmDelete(item)}
              />
            </Card>
          );
        }}
      />
    </Screen>
  );
}
