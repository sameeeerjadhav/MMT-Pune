import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { Button, Input, Muted, Title } from '../components/ui';
import { getErrorMessage } from '../api/client';
import { colors, radius, shadow } from '../theme/tokens';
import { roleBlurb, roleLabel } from '../utils/roles';

const DEMO_USERS = [
  { username: 'employee', role: 'WAREHOUSE_EMPLOYEE' as const },
  { username: 'supervisor', role: 'SUPERVISOR' as const },
  { username: 'admin', role: 'ADMIN' as const },
];

export default function LoginScreen() {
  const { login } = useAuth();
  const insets = useSafeAreaInsets();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
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
    <View style={{ flex: 1, backgroundColor: colors.navy }}>
      <View
        style={{
          paddingTop: insets.top + 28,
          paddingHorizontal: 24,
          paddingBottom: 28,
        }}
      >
        <Text style={{ color: colors.primarySoft, fontWeight: '700', letterSpacing: 1.2, fontSize: 12 }}>
          AIRPORT EQUIPMENT
        </Text>
        <Text
          style={{
            color: '#fff',
            fontSize: 34,
            fontWeight: '800',
            marginTop: 10,
            letterSpacing: -0.6,
          }}
        >
          Warehouse
        </Text>
        <Text style={{ color: 'rgba(255,255,255,0.72)', marginTop: 8, lineHeight: 22, fontSize: 15 }}>
          Scan, put away, transfer, and withdraw inventory with FIFO controls.
        </Text>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{
          flex: 1,
          backgroundColor: colors.background,
          borderTopLeftRadius: 28,
          borderTopRightRadius: 28,
          padding: 24,
          ...shadow.soft,
        }}
      >
        <Title>Sign in</Title>
        <Muted>Use your warehouse account. Demo roles below for walkthroughs.</Muted>

        <View style={{ marginTop: 20 }}>
          <Input
            autoCapitalize="none"
            placeholder="Username"
            value={username}
            onChangeText={setUsername}
          />
          <Input
            secureTextEntry
            placeholder="Password"
            value={password}
            onChangeText={setPassword}
          />
          {error ? <Text style={{ color: colors.danger, marginBottom: 8 }}>{error}</Text> : null}
          <Button label="Continue" onPress={onSubmit} loading={loading} />
        </View>

        <Text
          style={{
            marginTop: 22,
            marginBottom: 10,
            color: colors.muted,
            fontSize: 12,
            fontWeight: '700',
            letterSpacing: 0.8,
            textTransform: 'uppercase',
          }}
        >
          Demo roles
        </Text>
        {DEMO_USERS.map((u) => (
          <Pressable
            key={u.username}
            onPress={() => {
              setUsername(u.username);
              setPassword('Demo@12345');
              setError('');
            }}
            style={({ pressed }) => ({
              backgroundColor: username === u.username ? colors.primarySoft : colors.surface,
              borderRadius: radius.md,
              padding: 14,
              marginBottom: 10,
              opacity: pressed ? 0.9 : 1,
              borderWidth: 1,
              borderColor: username === u.username ? colors.primary : colors.borderSoft,
            })}
          >
            <Text style={{ fontWeight: '800', color: colors.navy }}>{roleLabel(u.role)}</Text>
            <Text style={{ color: colors.muted, marginTop: 4, fontSize: 13, lineHeight: 18 }}>
              {u.username} · {roleBlurb(u.role)}
            </Text>
          </Pressable>
        ))}
      </KeyboardAvoidingView>
    </View>
  );
}
