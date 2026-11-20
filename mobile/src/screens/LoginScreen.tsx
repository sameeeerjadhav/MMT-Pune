import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Text } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { Button, Card, Input, Screen, Title, Muted } from '../components/ui';
import { getErrorMessage } from '../api/client';
import { colors } from '../theme/tokens';

export default function LoginScreen() {
  const { login } = useAuth();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('Demo@12345');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const onSubmit = async () => {
    setLoading(true);
    setError('');
    try {
      await login(username.trim(), password);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'center' }}>
        <Text style={{ fontSize: 14, fontWeight: '700', color: colors.primary, marginBottom: 8 }}>
          AIRPORT EQUIPMENT MANUFACTURING
        </Text>
        <Title>Warehouse Inventory</Title>
        <Muted>Sign in to manage receiving, racks, scanning and FIFO withdrawals.</Muted>
        <Card style={{ marginTop: 24 }}>
          <Input autoCapitalize="none" placeholder="Username or email" value={username} onChangeText={setUsername} />
          <Input secureTextEntry placeholder="Password" value={password} onChangeText={setPassword} />
          {error ? <Text style={{ color: colors.danger, marginBottom: 8 }}>{error}</Text> : null}
          <Button label="Login" onPress={onSubmit} loading={loading} />
        </Card>
        <Muted>Demo: admin / supervisor / employee — password Demo@12345</Muted>
      </KeyboardAvoidingView>
    </Screen>
  );
}
