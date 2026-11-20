import React, { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { API_BASE_URL } from '../api/client';
import { healthApi } from '../api/endpoints';
import { Button, Card, Muted, Screen, Subtitle, Title } from '../components/ui';
import { activeScanner } from '../services/hardware/scanner';
import { activePrinter } from '../services/hardware/printer';

export default function SettingsScreen() {
  const { user, logout } = useAuth();
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
    <Screen>
      <Title>Settings</Title>
      <Card>
        <Subtitle>Profile</Subtitle>
        <Text>
          {user?.first_name} {user?.last_name}
        </Text>
        <Muted>
          {user?.username} | {user?.role} | {user?.employee_id}
        </Muted>
      </Card>
      <Card>
        <Subtitle>API connection</Subtitle>
        <Text>{API_BASE_URL}</Text>
        <Muted>Status: {apiStatus}</Muted>
      </Card>
      <Card>
        <Subtitle>Scanner / Printer</Subtitle>
        <Text>Scanner HAL: {scannerStatus} (camera/manual for demo)</Text>
        <Text>Printer HAL: {printerStatus} (preview only)</Text>
        <Muted>Zebra DataWedge / Link-OS stubs are present but not hardware-tested.</Muted>
      </Card>
      <Button label="Logout" variant="danger" onPress={logout} />
    </Screen>
  );
}
