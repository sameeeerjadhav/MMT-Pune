import React, { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { API_BASE_URL } from '../api/client';
import { healthApi } from '../api/endpoints';
import { GearIcon, UserIcon } from '../components/icons';
import { Badge, Button, Card, Muted, Screen, SectionLabel, Subtitle } from '../components/ui';
import { useTabScrollPadding } from '../hooks/useTabScrollPadding';
import { activeScanner } from '../services/hardware/scanner';
import { activePrinter } from '../services/hardware/printer';
import { colors } from '../theme/tokens';
import { roleBlurb, roleLabel } from '../utils/roles';

export default function SettingsScreen() {
  const { user, logout } = useAuth();
  const scrollPad = useTabScrollPadding(28);
  const [apiStatus, setApiStatus] = useState('checking...');
  const [scannerStatus, setScannerStatus] = useState('...');
  const [printerStatus, setPrinterStatus] = useState('...');

  useEffect(() => {
    healthApi
      .check()
      .then(() => setApiStatus('online'))
      .catch(() => setApiStatus('offline'));
    activeScanner.getStatus().then(setScannerStatus);
    activePrinter.getStatus().then(setPrinterStatus);
  }, []);

  return (
    <Screen style={{ padding: 0 }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: scrollPad }}>
      <Muted>Account, connection, and device adapters.</Muted>

      <Card style={{ marginTop: 12 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <UserIcon size={20} color={colors.navy} />
            <Subtitle>Profile</Subtitle>
          </View>
          <Badge
            label={roleLabel(user?.role)}
            tone={user?.role === 'ADMIN' ? 'danger' : user?.role === 'SUPERVISOR' ? 'warning' : 'primary'}
          />
        </View>
        <Text style={{ fontWeight: '700', color: colors.navy, fontSize: 16 }}>
          {user?.first_name} {user?.last_name}
        </Text>
        <Muted>
          {user?.username} · {user?.employee_id || 'no employee id'}
        </Muted>
        <Muted>{roleBlurb(user?.role)}</Muted>
      </Card>

      <SectionLabel>Connection</SectionLabel>
      <Card>
        <Text style={{ color: colors.text }}>{API_BASE_URL}</Text>
        <Muted>Status: {apiStatus}</Muted>
      </Card>

      <SectionLabel>Hardware HAL</SectionLabel>
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <GearIcon size={18} color={colors.muted} />
          <Muted>Device adapters</Muted>
        </View>
        <Text style={{ color: colors.text }}>Scanner: {scannerStatus}</Text>
        <Text style={{ color: colors.text }}>Printer: {printerStatus}</Text>
        <Muted>Camera/manual for demo. Zebra stubs are not hardware-tested.</Muted>
      </Card>

      <Button label="Sign out" variant="danger" onPress={logout} />
      </ScrollView>
    </Screen>
  );
}
