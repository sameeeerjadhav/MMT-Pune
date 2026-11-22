import React from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';
import { BrandMark } from './BrandMark';
import { colors } from '../theme/tokens';

type Props = {
  message?: string;
  hint?: string;
};

/**
 * Full-screen boot / auth loading — ALSTEF mark + wordmark, then status.
 * Uses system fonts so it works before custom fonts finish loading.
 */
export function BootLoading({
  message = 'Loading warehouse…',
  hint,
}: Props) {
  return (
    <View style={styles.root}>
      <BrandMark size="hero" style={styles.mark} />
      <Image
        source={require('../../assets/alstef-group.jpg')}
        style={styles.wordmark}
        resizeMode="contain"
        accessibilityLabel="ALSTEF Group"
      />
      <ActivityIndicator size="large" color={colors.primary} style={styles.spinner} />
      <Text style={styles.message}>{message}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    paddingHorizontal: 32,
  },
  mark: {
    marginBottom: 16,
  },
  wordmark: {
    width: '100%',
    maxWidth: 260,
    height: 48,
    marginBottom: 28,
  },
  spinner: {
    marginTop: 4,
  },
  message: {
    marginTop: 14,
    color: colors.muted,
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '500',
  },
  hint: {
    marginTop: 8,
    color: colors.tabInactive,
    textAlign: 'center',
    fontSize: 12,
    lineHeight: 18,
    maxWidth: 280,
  },
});
