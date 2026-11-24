import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { getErrorMessage } from '../api/client';
import { authApi } from '../api/endpoints';
import {
  Badge,
  Button,
  Card,
  ErrorState,
  FormActions,
  Input,
  Muted,
  Screen,
  Subtitle,
} from '../components/ui';
import { DetailSkeleton } from '../components/Skeleton';
import { UserIcon } from '../components/icons';
import { useTabScrollPadding } from '../hooks/useTabScrollPadding';
import { colors, fonts } from '../theme/tokens';
import { roleLabel } from '../utils/roles';

function DetailRow({ label, value }: { label: string; value?: string | number | null }) {
  if (value === undefined || value === null || value === '') return null;
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{String(value)}</Text>
    </View>
  );
}

function initials(user: { first_name?: string; last_name?: string; username?: string } | null) {
  const a = (user?.first_name || '').trim();
  const b = (user?.last_name || '').trim();
  if (a || b) return `${a.charAt(0)}${b.charAt(0)}`.toUpperCase() || a.charAt(0).toUpperCase();
  return (user?.username || '?').slice(0, 2).toUpperCase();
}

export default function ProfileScreen({ navigation }: any) {
  const { user, refreshProfile, logout } = useAuth();
  const scrollPad = useTabScrollPadding(28);
  const [loading, setLoading] = useState(!user);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveMsg, setSaveMsg] = useState('');
  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    email: '',
    username: '',
    employee_id: '',
    current_password: '',
    new_password: '',
    confirm_password: '',
  });

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        setError('');
        setLoading(true);
        try {
          await refreshProfile();
        } catch (e) {
          if (!cancelled) setError(getErrorMessage(e));
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [refreshProfile])
  );

  if (loading && !user) return <DetailSkeleton />;
  if (!user) return <ErrorState message={error || 'Not signed in'} />;

  const fullName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.username;
  // Admins can change every detail of their own account; other roles can change name, email and password.
  const isAdmin = user.role === 'ADMIN';

  const startEdit = () => {
    setForm({
      first_name: user.first_name || '',
      last_name: user.last_name || '',
      email: user.email || '',
      username: user.username || '',
      employee_id: user.employee_id || '',
      current_password: '',
      new_password: '',
      confirm_password: '',
    });
    setSaveError('');
    setSaveMsg('');
    setEditing(true);
  };

  const saveProfile = async () => {
    setSaveError('');
    setSaveMsg('');
    const payload: Record<string, unknown> = {};
    const editable = (isAdmin
      ? ['first_name', 'last_name', 'email', 'username', 'employee_id']
      : ['first_name', 'last_name', 'email']) as Array<
      'first_name' | 'last_name' | 'email' | 'username' | 'employee_id'
    >;
    for (const key of editable) {
      const next = form[key].trim();
      if (next !== (user[key] || '')) payload[key] = next;
    }
    if (isAdmin && !form.username.trim()) {
      setSaveError('Username cannot be empty.');
      return;
    }
    if (form.current_password || form.new_password || form.confirm_password) {
      if (!form.current_password) {
        setSaveError('Enter your current password to change it.');
        return;
      }
      if (form.new_password.length < 6) {
        setSaveError('New password must be at least 6 characters.');
        return;
      }
      if (form.new_password !== form.confirm_password) {
        setSaveError('New passwords do not match.');
        return;
      }
      payload.current_password = form.current_password;
      payload.new_password = form.new_password;
    }
    if (Object.keys(payload).length === 0) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await authApi.updateProfile(payload);
      await refreshProfile();
      setEditing(false);
      setSaveMsg(
        payload.username
          ? 'Details saved. Use your new username the next time you sign in.'
          : payload.new_password
            ? 'Details and password saved.'
            : 'Details saved.'
      );
    } catch (e) {
      setSaveError(getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen style={{ padding: 0 }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: scrollPad }}>
        <Card>
          <View style={styles.hero}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initials(user)}</Text>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.name} numberOfLines={2}>
                {fullName}
              </Text>
              <Muted>@{user.username}</Muted>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                <Badge
                  label={roleLabel(user.role)}
                  tone={
                    user.role === 'ADMIN' ? 'danger' : user.role === 'SUPERVISOR' ? 'warning' : 'primary'
                  }
                />
                {user.is_main_admin ? <Badge label="Main admin" tone="danger" /> : null}
                <Badge
                  label={user.is_active === false ? 'Inactive' : 'Active'}
                  tone={user.is_active === false ? 'warning' : 'success'}
                />
              </View>
            </View>
          </View>
        </Card>

        <Card>
          <View style={styles.sectionHead}>
            <UserIcon size={18} color={colors.navy} />
            <Subtitle>Account details</Subtitle>
          </View>
          <DetailRow label="Username" value={user.username} />
          <DetailRow label="First name" value={user.first_name || '—'} />
          <DetailRow label="Last name" value={user.last_name || '—'} />
          <DetailRow label="Email" value={user.email || '—'} />
          <DetailRow label="Employee ID" value={user.employee_id || '—'} />
          <DetailRow label="Role" value={roleLabel(user.role)} />
          <DetailRow label="User ID" value={user.id} />
          <DetailRow label="Main admin" value={user.is_main_admin ? 'Yes' : 'No'} />
          <DetailRow label="Status" value={user.is_active === false ? 'Inactive' : 'Active'} />
          {!editing ? (
            <View style={{ marginTop: 12 }}>
              <Button label="Edit my details" variant="secondary" onPress={startEdit} />
            </View>
          ) : null}
          {saveMsg ? <Muted>{saveMsg}</Muted> : null}
        </Card>

        {editing ? (
          <Card>
            <View style={styles.sectionHead}>
              <UserIcon size={18} color={colors.navy} />
              <Subtitle>Edit my details</Subtitle>
            </View>
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
              autoCapitalize="none"
              keyboardType="email-address"
              onChangeText={(t) => setForm((f) => ({ ...f, email: t }))}
            />
            {isAdmin ? (
              <>
                <Input
                  label="Username"
                  value={form.username}
                  autoCapitalize="none"
                  autoCorrect={false}
                  onChangeText={(t) => setForm((f) => ({ ...f, username: t }))}
                />
                <Input
                  label="Employee ID"
                  value={form.employee_id}
                  onChangeText={(t) => setForm((f) => ({ ...f, employee_id: t }))}
                />
              </>
            ) : (
              <Muted>Username and employee ID can only be changed by an admin.</Muted>
            )}

            <View style={{ marginTop: 6 }}>
              <Subtitle>Change password (optional)</Subtitle>
            </View>
            <Input
              label="Current password"
              value={form.current_password}
              secureTextEntry
              autoCapitalize="none"
              onChangeText={(t) => setForm((f) => ({ ...f, current_password: t }))}
            />
            <Input
              label="New password"
              value={form.new_password}
              secureTextEntry
              autoCapitalize="none"
              onChangeText={(t) => setForm((f) => ({ ...f, new_password: t }))}
            />
            <Input
              label="Confirm new password"
              value={form.confirm_password}
              secureTextEntry
              autoCapitalize="none"
              onChangeText={(t) => setForm((f) => ({ ...f, confirm_password: t }))}
            />
            {saveError ? <Text style={{ color: colors.danger, marginBottom: 8 }}>{saveError}</Text> : null}
            <FormActions
              primaryLabel="Save"
              onPrimary={saveProfile}
              loading={saving}
              onCancel={() => {
                setEditing(false);
                setSaveError('');
              }}
            />
          </Card>
        ) : null}

        {error ? <Muted>{error}</Muted> : null}

        <Button label="Back to home" variant="secondary" onPress={() => navigation.goBack()} />
        <View style={{ height: 8 }} />
        <Button label="Sign out" variant="danger" onPress={logout} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.primary,
  },
  avatarText: {
    fontFamily: fonts.displaySemi,
    fontSize: 24,
    color: colors.primaryDark,
  },
  name: {
    fontFamily: fonts.display,
    fontSize: 22,
    color: colors.navy,
    letterSpacing: -0.4,
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSoft,
  },
  rowLabel: {
    fontFamily: fonts.uiMedium,
    color: colors.muted,
    fontSize: 13,
    flex: 1,
  },
  rowValue: {
    fontFamily: fonts.uiSemi,
    color: colors.navy,
    fontSize: 14,
    flex: 1.4,
    textAlign: 'right',
  },
});
