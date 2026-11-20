import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { Badge, Card, Muted, Screen, SectionLabel, Title } from '../components/ui';
import { colors } from '../theme/tokens';
import { moreLinksForRole, roleBlurb, roleLabel } from '../utils/roles';

export default function MoreScreen() {
  const { user, logout } = useAuth();
  const navigation = useNavigation<any>();
  const links = moreLinksForRole(user?.role);

  return (
    <Screen style={{ padding: 0 }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Title>More</Title>
        <Muted>{roleBlurb(user?.role)}</Muted>

        <Card style={{ marginTop: 16 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '800', color: colors.navy, fontSize: 16 }}>
                {user?.first_name || user?.username}
              </Text>
              <Muted>
                {user?.username} · {user?.employee_id || 'no emp id'}
              </Muted>
            </View>
            <Badge
              label={roleLabel(user?.role)}
              tone={user?.role === 'ADMIN' ? 'danger' : user?.role === 'SUPERVISOR' ? 'warning' : 'primary'}
            />
          </View>
        </Card>

        <SectionLabel>Modules for your role</SectionLabel>
        {links.map((link) => (
          <Pressable
            key={link.key}
            onPress={() => navigation.navigate(link.tab)}
            style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
          >
            <Card>
              <Text style={{ fontWeight: '800', color: colors.navy, fontSize: 16 }}>{link.title}</Text>
              <Muted>{link.subtitle}</Muted>
            </Card>
          </Pressable>
        ))}

        <Pressable onPress={logout}>
          <Card style={{ backgroundColor: colors.dangerSoft }}>
            <Text style={{ fontWeight: '800', color: colors.danger }}>Sign out</Text>
            <Muted>Clear session on this device</Muted>
          </Card>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}
