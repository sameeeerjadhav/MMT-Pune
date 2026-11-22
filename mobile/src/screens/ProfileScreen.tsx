import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { getErrorMessage } from '../api/client';
import { Badge, Button, Card, ErrorState, Muted, Screen, Subtitle } from '../components/ui';
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
        </Card>

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
