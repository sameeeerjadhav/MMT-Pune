import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { Button, FieldLabel, Input, Muted, Title } from '../components/ui';
import { BrandMark } from '../components/BrandMark';
import { EyeIcon, EyeOffIcon } from '../components/icons';
import { getErrorMessage } from '../api/client';
import { colors, fonts, radius, shadow, spacing } from '../theme/tokens';

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
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const onSubmit = async () => {
    if (loading) return;
    if (!username.trim() || !password) {
      setError('Enter your username and password.');
      return;
    }
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
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false}
          style={{ flex: 1 }}
          contentContainerStyle={{ flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
          bounces
        >
          <View
            style={{
              paddingTop: insets.top + 28,
              paddingHorizontal: 24,
              paddingBottom: 28,
            }}
          >
            <BrandMark size="lg" style={{ marginBottom: 14 }} />
            <Text
              style={{
                color: colors.primarySoft,
                fontFamily: fonts.uiSemi,
                letterSpacing: 1.2,
                fontSize: 12,
              }}
            >
              ALSTEF GROUP
            </Text>
            <Text
              style={{
                color: '#fff',
                fontSize: 34,
                fontFamily: fonts.display,
                marginTop: 10,
                letterSpacing: -0.6,
              }}
            >
              Warehouse
            </Text>
            <Text
              style={{
                color: 'rgba(255,255,255,0.72)',
                marginTop: 8,
                lineHeight: 22,
                fontSize: 15,
                fontFamily: fonts.ui,
              }}
            >
              Scan, put away, transfer, and withdraw — older stock is used first.
            </Text>
          </View>

          <View
            style={{
              flexGrow: 1,
              backgroundColor: colors.background,
              borderTopLeftRadius: 28,
              borderTopRightRadius: 28,
              padding: 24,
              paddingBottom: Math.max(insets.bottom, 24) + 16,
              ...shadow.soft,
            }}
          >
            <Title>Sign in</Title>
            <Muted>Use your warehouse account.</Muted>

            <View style={{ marginTop: 20 }}>
              <Input
                label="Username"
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="Username"
                value={username}
                onChangeText={setUsername}
                returnKeyType="next"
              />

              <View style={{ marginBottom: spacing.sm }}>
                <FieldLabel>Password</FieldLabel>
                <View style={styles.passwordWrap}>
                  <TextInput
                    value={password}
                    onChangeText={setPassword}
                    placeholder="Password"
                    placeholderTextColor={colors.muted}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="go"
                    onSubmitEditing={onSubmit}
                    style={styles.passwordInput}
                  />
                  <Pressable
                    onPress={() => setShowPassword((v) => !v)}
                    accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                    hitSlop={8}
                    style={({ pressed }) => [styles.eyeBtn, { opacity: pressed ? 0.65 : 1 }]}
                  >
                    {showPassword ? (
                      <EyeIcon size={20} color={colors.muted} />
                    ) : (
                      <EyeOffIcon size={20} color={colors.muted} />
                    )}
                  </Pressable>
                </View>
              </View>

              {error ? <Text style={{ color: colors.danger, marginBottom: 8 }}>{error}</Text> : null}
              <Button label="Continue" onPress={onSubmit} loading={loading} />
            </View>

          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  passwordWrap: {
    position: 'relative',
    justifyContent: 'center',
  },
  passwordInput: {
    borderWidth: 1,
    borderColor: colors.borderSoft,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    paddingRight: 48,
    color: colors.text,
    fontSize: 16,
    fontFamily: fonts.ui,
  },
  eyeBtn: {
    position: 'absolute',
    right: 12,
    top: 0,
    bottom: 0,
    width: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
