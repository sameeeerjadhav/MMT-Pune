import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  ViewStyle,
} from 'react-native';
import { colors, radius, shadow, spacing } from '../theme/tokens';

export function Screen({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.screen, style]}>{children}</View>;
}

export function Card({
  children,
  style,
  padded = true,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
  padded?: boolean;
}) {
  return <View style={[styles.card, padded && styles.cardPad, style]}>{children}</View>;
}

export function Title({ children }: { children: React.ReactNode }) {
  return <Text style={styles.title}>{children}</Text>;
}

export function Subtitle({ children }: { children: React.ReactNode }) {
  return <Text style={styles.subtitle}>{children}</Text>;
}

export function Muted({ children }: { children: React.ReactNode }) {
  return <Text style={styles.muted}>{children}</Text>;
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  loading,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'success' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
}) {
  const palette =
    variant === 'primary'
      ? { bg: colors.primary, text: '#fff' }
      : variant === 'danger'
        ? { bg: colors.danger, text: '#fff' }
        : variant === 'success'
          ? { bg: colors.success, text: '#fff' }
          : variant === 'ghost'
            ? { bg: 'transparent', text: colors.primary }
            : { bg: colors.primarySoft, text: colors.primaryDark };

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: palette.bg,
          opacity: disabled || loading ? 0.55 : pressed ? 0.88 : 1,
          borderWidth: variant === 'ghost' ? 1 : 0,
          borderColor: colors.border,
        },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={palette.text} />
      ) : (
        <Text style={[styles.buttonText, { color: palette.text }]}>{label}</Text>
      )}
    </Pressable>
  );
}

export function ActionTile({
  title,
  subtitle,
  onPress,
  tone = 'primary',
}: {
  title: string;
  subtitle?: string;
  onPress: () => void;
  tone?: 'primary' | 'accent' | 'success' | 'navy';
}) {
  const bg =
    tone === 'accent'
      ? colors.accentSoft
      : tone === 'success'
        ? colors.successSoft
        : tone === 'navy'
          ? colors.surfaceMuted
          : colors.primarySoft;
  const titleColor =
    tone === 'accent'
      ? colors.accent
      : tone === 'success'
        ? colors.success
        : tone === 'navy'
          ? colors.navy
          : colors.primaryDark;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.tile, { backgroundColor: bg, opacity: pressed ? 0.9 : 1 }]}
    >
      <Text style={[styles.tileTitle, { color: titleColor }]}>{title}</Text>
      {subtitle ? <Text style={styles.tileSub}>{subtitle}</Text> : null}
    </Pressable>
  );
}

export function Metric({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

export function Input(props: React.ComponentProps<typeof TextInput>) {
  return (
    <TextInput
      {...props}
      placeholderTextColor={colors.muted}
      style={[styles.input, props.style]}
    />
  );
}

export function Badge({
  label,
  tone = 'primary',
}: {
  label: string;
  tone?: 'primary' | 'success' | 'warning' | 'danger';
}) {
  const bg =
    tone === 'success'
      ? colors.successSoft
      : tone === 'warning'
        ? colors.warningSoft
        : tone === 'danger'
          ? colors.dangerSoft
          : colors.primarySoft;
  const color =
    tone === 'success'
      ? colors.success
      : tone === 'warning'
        ? colors.warning
        : tone === 'danger'
          ? colors.danger
          : colors.primaryDark;
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={{ color, fontWeight: '700', fontSize: 12 }}>{label}</Text>
    </View>
  );
}

export function LoadingState() {
  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Muted>Loading...</Muted>
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={styles.center}>
      <Text style={{ color: colors.danger, marginBottom: spacing.sm, textAlign: 'center' }}>
        {message}
      </Text>
      {onRetry ? <Button label="Retry" onPress={onRetry} /> : null}
    </View>
  );
}

export function FifoAlert({ message, older }: { message: string; older?: any }) {
  return (
    <View style={styles.fifo}>
      <Text style={styles.fifoTitle}>FIFO VIOLATION</Text>
      <Text style={styles.fifoMsg}>{message}</Text>
      {older ? (
        <Text style={styles.fifoMsg}>
          Older: {older.code} | Date: {String(older.grn_date).slice(0, 10)} | Qty: {older.available_qty}
          {'\n'}
          Loc: {older.warehouse}/{older.rack}/{older.shelf}/{older.position}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, padding: spacing.md },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    marginBottom: spacing.md,
    ...shadow.soft,
  },
  cardPad: { padding: spacing.md },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.navy,
    letterSpacing: -0.4,
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: spacing.sm,
    marginTop: spacing.xs,
  },
  muted: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  button: {
    minHeight: 50,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    marginVertical: spacing.xs,
  },
  buttonText: { fontWeight: '700', fontSize: 16 },
  tile: {
    width: '48%',
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  tileTitle: { fontWeight: '800', fontSize: 15, marginBottom: 4 },
  tileSub: { color: colors.muted, fontSize: 12, lineHeight: 16 },
  metric: {
    flex: 1,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    padding: spacing.md,
    minWidth: '30%',
  },
  metricValue: { fontSize: 20, fontWeight: '800', color: colors.navy },
  metricLabel: { fontSize: 12, color: colors.muted, marginTop: 4 },
  input: {
    borderWidth: 1,
    borderColor: colors.borderSoft,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    marginBottom: spacing.sm,
    color: colors.text,
    fontSize: 16,
  },
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: spacing.lg },
  fifo: {
    backgroundColor: colors.warningSoft,
    borderRadius: radius.md,
    padding: spacing.md,
    marginVertical: spacing.sm,
  },
  fifoTitle: { color: colors.warning, fontWeight: '800', marginBottom: 4 },
  fifoMsg: { color: colors.text, lineHeight: 20 },
});
