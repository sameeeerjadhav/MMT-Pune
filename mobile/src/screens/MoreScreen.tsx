import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { LogoutIcon, MORE_LINK_ICONS, UserIcon } from '../components/icons';
import { Badge, Card, Muted, Screen, SectionLabel } from '../components/ui';
import { PageHeader } from '../components/PageHeader';
import { SyncStatusCard } from '../components/SyncStatusCard';
import { colors, fonts } from '../theme/tokens';
import { useTabScrollPadding } from '../hooks/useTabScrollPadding';
import { moreLinksForRole, roleLabel } from '../utils/roles';

export default function MoreScreen() {
  const { user, logout } = useAuth();
  const navigation = useNavigation<any>();
  const scrollPad = useTabScrollPadding(28);
  const links = moreLinksForRole(user?.role);

  return (
    <Screen style={{ padding: 0 }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: scrollPad }}>
        <PageHeader title="More" safeTop />

        <Card>
          <View style={styles.profileRow}>
            <View style={styles.profileLeft}>
              <View style={styles.avatar}>
                <UserIcon size={24} color={colors.primaryDark} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.profileName}>{user?.first_name || user?.username}</Text>
                <Muted>
                  {user?.username} · {user?.employee_id || 'no emp id'}
                </Muted>
              </View>
            </View>
            <Badge
              label={roleLabel(user?.role)}
              tone={user?.role === 'ADMIN' ? 'danger' : user?.role === 'SUPERVISOR' ? 'warning' : 'primary'}
            />
          </View>
        </Card>

        <SyncStatusCard />

        <SectionLabel>Modules for your role</SectionLabel>
        {links.map((link) => {
          const Icon = MORE_LINK_ICONS[link.key as keyof typeof MORE_LINK_ICONS];
          return (
            <Pressable
              key={link.key}
              onPress={() => {
                if (link.tab === 'Withdrawal') {
                  navigation.navigate('Withdrawal', {
                    screen: 'WithdrawalMain',
                    params: { batchId: undefined, unitId: undefined, resetKey: Date.now() },
                  });
                  return;
                }
                navigation.navigate(link.tab);
              }}
              style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
            >
              <Card>
                <View style={styles.linkRow}>
                  <View style={styles.linkIcon}>
                    {Icon ? <Icon size={22} color={colors.primaryDark} /> : null}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.linkTitle}>{link.title}</Text>
                    <Muted>{link.subtitle}</Muted>
                  </View>
                </View>
              </Card>
            </Pressable>
          );
        })}

        <Pressable onPress={logout}>
          <Card style={{ backgroundColor: colors.dangerSoft }}>
            <View style={styles.linkRow}>
              <LogoutIcon size={22} />
              <View style={{ flex: 1 }}>
                <Text style={styles.signOut}>Sign out</Text>
                <Muted>Clear session on this device</Muted>
              </View>
            </View>
          </Card>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  profileRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  profileLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileName: {
    fontFamily: fonts.uiBold,
    color: colors.navy,
    fontSize: 16,
  },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  linkIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkTitle: {
    fontFamily: fonts.uiBold,
    color: colors.navy,
    fontSize: 16,
  },
  signOut: {
    fontFamily: fonts.uiBold,
    color: colors.danger,
  },
});
