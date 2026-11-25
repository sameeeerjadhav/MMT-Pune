import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Pressable, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { usersApi } from '../api/endpoints';
import { getErrorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import {
  Badge,
  Card,
  ErrorState,
  FilterChips,
  FormActions,
  Input,
  ManageActionBar,
  Muted,
  Screen,
  SearchInput,
  Subtitle,
  TextAction,
} from '../components/ui';
import { ListSkeleton } from '../components/Skeleton';
import { PageHeader } from '../components/PageHeader';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useTabScrollPadding } from '../hooks/useTabScrollPadding';
import { colors } from '../theme/tokens';
import { canAccess, roleLabel } from '../utils/roles';

type StaffRole = 'ADMIN' | 'SUPERVISOR' | 'WAREHOUSE_EMPLOYEE';
type RoleFilter = '' | StaffRole;

export default function UsersScreen() {
  const { user, refreshProfile } = useAuth();
  const canManage = canAccess(user?.role, 'manageUsers');
  const isMainAdmin = Boolean(user?.is_main_admin);
  const scrollPad = useTabScrollPadding(28);
  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q, 160);
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('');
  const [draftRole, setDraftRole] = useState<RoleFilter>('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
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

  // Any admin can create another admin; only main admin can promote via edit.
  const roleOptions = useMemo(() => {
    const all: { code: StaffRole; label: string }[] = [
      { code: 'ADMIN', label: 'Admin' },
      { code: 'SUPERVISOR', label: 'Supervisor' },
      { code: 'WAREHOUSE_EMPLOYEE', label: 'Warehouse Employee' },
    ];
    if (editing && !isMainAdmin) {
      return all.filter((o) => o.code !== 'ADMIN');
    }
    return all;
  }, [editing, isMainAdmin]);

  const roleFilterLabel =
    roleFilter === 'ADMIN'
      ? 'Admin'
      : roleFilter === 'SUPERVISOR'
        ? 'Supervisor'
        : roleFilter === 'WAREHOUSE_EMPLOYEE'
          ? 'Employee'
          : '';

  const hasRows = useRef(false);

  const load = useCallback(async (opts?: { soft?: boolean; signal?: { cancelled: boolean } }) => {
    setError('');
    if (opts?.soft) setSearching(true);
    else setLoading(true);
    try {
      const { data } = await usersApi.list({
        q: debouncedQ.trim() || undefined,
        role: roleFilter || undefined,
        include_inactive: '1',
      });
      if (opts?.signal?.cancelled) return;
      setRows(data);
      // "Loaded once", not "has rows": an empty search must stay a soft reload so the search box keeps focus.
      hasRows.current = true;
    } catch (e) {
      if (opts?.signal?.cancelled) return;
      setError(getErrorMessage(e));
    } finally {
      if (!opts?.signal?.cancelled) {
        setLoading(false);
        setSearching(false);
      }
    }
  }, [debouncedQ, roleFilter]);

  useFocusEffect(
    useCallback(() => {
      const signal = { cancelled: false };
      // Refresh profile once per focus — refreshProfile is stable (no loop).
      void refreshProfile().catch(() => undefined);
      void load({ soft: hasRows.current, signal });
      return () => {
        signal.cancelled = true;
      };
    }, [debouncedQ, roleFilter, refreshProfile, load])
  );

  if (!canManage) {
    return <ErrorState message="Only administrators can manage users." />;
  }

  const canManageRow = (row: any) => {
    if (!row) return false;
    if (row.id === user?.id) return false;
    if (row.is_main_admin) return false;
    if (row.role === 'ADMIN') return isMainAdmin;
    return true;
  };

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
    if (!canManageRow(row)) {
      setError(
        row.is_main_admin || row.id === user?.id
          ? 'The main admin account cannot be edited here.'
          : 'Only the main admin can manage other admin accounts.'
      );
      return;
    }
    setCreating(false);
    setEditing(row);
    const role: StaffRole =
      row.role === 'ADMIN'
        ? 'ADMIN'
        : row.role === 'SUPERVISOR'
          ? 'SUPERVISOR'
          : 'WAREHOUSE_EMPLOYEE';
    setForm({
      username: row.username || '',
      password: '',
      first_name: row.first_name || '',
      last_name: row.last_name || '',
      email: row.email || '',
      employee_id: row.employee_id || '',
      role,
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
      await load({ soft: true });
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
      await load({ soft: true });
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const confirmToggle = (row: any) => {
    if (!canManageRow(row)) return;
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
      await load({ soft: true });
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = (row: any) => {
    if (!canManageRow(row)) return;
    Alert.alert(
      'Delete user',
      `Permanently delete ${row.username}? Prefer Deactivate if they have withdrawal history.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => removeUser(row) },
      ]
    );
  };

  if (loading && !rows.length) return <ListSkeleton rows={6} titleWidth="30%" />;
  if (error && !rows.length) return <ErrorState message={error} onRetry={() => load()} />;

  const header = (
    <View>
      <PageHeader title="Users" safeTop />
      <SearchInput
        placeholder="Search users..."
        value={q}
        onChangeText={setQ}
        searching={searching}
        onClear={() => setQ('')}
        onFilterPress={() => {
          if (filtersOpen) {
            setDraftRole(roleFilter);
            setFiltersOpen(false);
          } else {
            setDraftRole(roleFilter);
            setFiltersOpen(true);
          }
        }}
        filterOpen={filtersOpen}
        filterActive={Boolean(roleFilter)}
      />
      {filtersOpen ? (
        <Card>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Muted>Filter by role</Muted>
            {draftRole ? (
              <TextAction label="Clear" onPress={() => setDraftRole('')} />
            ) : null}
          </View>
          <FilterChips
            value={draftRole}
            onChange={(v) => setDraftRole(v as RoleFilter)}
            options={[
              { value: '', label: 'All roles' },
              { value: 'ADMIN', label: 'Admin' },
              { value: 'SUPERVISOR', label: 'Supervisor' },
              { value: 'WAREHOUSE_EMPLOYEE', label: 'Employee' },
            ]}
          />
          <FormActions
            primaryLabel="Apply"
            onPrimary={() => {
              setRoleFilter(draftRole);
              setFiltersOpen(false);
            }}
            onCancel={() => {
              setDraftRole(roleFilter);
              setFiltersOpen(false);
            }}
          />
        </Card>
      ) : roleFilter ? (
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            backgroundColor: colors.primarySoft,
            borderRadius: 12,
            paddingHorizontal: 12,
            paddingVertical: 10,
            marginBottom: 8,
          }}
        >
          <Muted>Role: {roleFilterLabel}</Muted>
          <TextAction label="Clear" tone="muted" onPress={() => setRoleFilter('')} />
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Subtitle>Users ({rows.length})</Subtitle>
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
            {roleOptions.map((opt) => (
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
      <FlatList showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false}
        style={{ flex: 1 }}
        data={rows}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ paddingBottom: scrollPad }}
        ListHeaderComponent={header}
        ListEmptyComponent={
          !loading ? <Muted>No users yet. Tap + Add user.</Muted> : undefined
        }
        renderItem={({ item }) => {
          const active = item.is_active !== false;
          const manageable = canManageRow(item);
          return (
            <Card>
              <Pressable
                onPress={() => (manageable ? openEdit(item) : undefined)}
                style={{ paddingVertical: 4 }}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: '800', color: colors.navy, fontSize: 15 }}>
                      {item.username}
                      {item.is_main_admin ? ' · Main admin' : ''}
                    </Text>
                    <Muted>
                      {[item.first_name, item.last_name].filter(Boolean).join(' ') || 'No name'}
                      {item.employee_id ? ` · ${item.employee_id}` : ''}
                    </Muted>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    <Badge
                      label={roleLabel(item.role)}
                      tone={
                        item.role === 'ADMIN'
                          ? 'danger'
                          : item.role === 'SUPERVISOR'
                            ? 'warning'
                            : 'primary'
                      }
                    />
                    {!active ? <Badge label="Inactive" tone="danger" /> : null}
                  </View>
                </View>
              </Pressable>
              {manageable ? (
                <ManageActionBar
                  isActive={active}
                  disabled={saving}
                  onEdit={() => openEdit(item)}
                  onToggleActive={() => confirmToggle(item)}
                  onDelete={() => confirmDelete(item)}
                />
              ) : (
                <Muted>
                  {item.is_main_admin
                    ? 'Main admin is protected.'
                    : item.id === user?.id
                      ? 'This is your account.'
                      : 'Only the main admin can manage this admin.'}
                </Muted>
              )}
            </Card>
          );
        }}
      />
    </Screen>
  );
}
