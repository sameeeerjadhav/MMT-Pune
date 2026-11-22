import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  ViewStyle,
} from 'react-native';
import { CommonActions, useNavigation } from '@react-navigation/native';
import { FilterIcon, SearchIcon } from './icons';
import { colors, fonts, radius, shadow, spacing } from '../theme/tokens';

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
  icon,
}: {
  title: string;
  subtitle?: string;
  onPress: () => void;
  tone?: 'primary' | 'accent' | 'success' | 'navy';
  icon?: React.ReactNode;
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
      style={({ pressed }) => [
        styles.tile,
        { backgroundColor: bg, opacity: pressed ? 0.92 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] },
      ]}
    >
      {icon ? <View style={styles.tileIcon}>{icon}</View> : null}
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
      <View style={styles.metricAccent} />
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

export function FieldLabel({ children }: { children: React.ReactNode }) {
  return <Text style={styles.fieldLabel}>{children}</Text>;
}

export function Input({
  label,
  ...props
}: React.ComponentProps<typeof TextInput> & { label?: string }) {
  return (
    <View style={{ marginBottom: spacing.sm }}>
      {label ? <FieldLabel>{label}</FieldLabel> : null}
      <TextInput
        {...props}
        placeholderTextColor={colors.muted}
        style={[styles.input, { marginBottom: 0 }, props.style]}
      />
    </View>
  );
}

/** Search field with leading search icon + optional filter dropdown control on the right. */
export function SearchInput({
  label,
  value,
  onChangeText,
  onClear,
  onSubmitEditing,
  placeholder,
  searching,
  onFilterPress,
  filterOpen,
  filterActive,
  ...props
}: Omit<React.ComponentProps<typeof TextInput>, 'value' | 'onChangeText'> & {
  label?: string;
  value: string;
  onChangeText: (text: string) => void;
  /** Called after value is cleared — reload all records here. */
  onClear?: () => void;
  /** Optional spinner in the trailing slot while a live search is in flight. */
  searching?: boolean;
  /** When set, shows a small filter button on the right of the search bar. */
  onFilterPress?: () => void;
  filterOpen?: boolean;
  /** Dot badge when any filter is applied. */
  filterActive?: boolean;
}) {
  const clear = () => {
    onChangeText('');
    onClear?.();
  };
  const hasFilter = Boolean(onFilterPress);
  const trailingPad = hasFilter ? (value || searching ? 84 : 48) : 44;

  return (
    <View style={{ marginBottom: spacing.sm }}>
      {label ? <FieldLabel>{label}</FieldLabel> : null}
      <View style={styles.searchWrap}>
        <View style={styles.searchIconSlot} pointerEvents="none">
          <SearchIcon size={18} color={colors.muted} />
        </View>
        <TextInput
          {...props}
          value={value}
          onChangeText={onChangeText}
          onSubmitEditing={onSubmitEditing}
          placeholder={placeholder}
          placeholderTextColor={colors.muted}
          returnKeyType={props.returnKeyType ?? 'search'}
          style={[styles.input, styles.searchInput, { paddingRight: trailingPad }, props.style]}
        />
        <View style={styles.searchTrailing}>
          {searching ? (
            <ActivityIndicator size="small" color={colors.primary} style={{ marginRight: 4 }} />
          ) : value ? (
            <Pressable
              onPress={clear}
              accessibilityLabel="Clear search"
              hitSlop={8}
              style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}
            >
              <View style={styles.searchClearBtn}>
                <Text style={styles.searchClearX}>×</Text>
              </View>
            </Pressable>
          ) : null}
          {hasFilter ? (
            <Pressable
              onPress={onFilterPress}
              accessibilityLabel={filterOpen ? 'Hide filters' : 'Show filters'}
              hitSlop={6}
              style={({ pressed }) => [
                styles.searchFilterBtn,
                filterOpen && styles.searchFilterBtnOpen,
                filterActive && styles.searchFilterBtnActive,
                { opacity: pressed ? 0.75 : 1 },
              ]}
            >
              <FilterIcon
                size={16}
                color={filterOpen || filterActive ? colors.primaryDark : colors.muted}
              />
              {filterActive ? <View style={styles.searchFilterDot} /> : null}
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

/** Horizontal filter chips for stock / list screens. */
export function FilterChips({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.filterChipRow}
      style={{ marginBottom: spacing.sm }}
    >
      {options.map((opt) => {
        const selected = value === opt.value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            style={[
              styles.filterChip,
              selected && styles.filterChipSelected,
            ]}
          >
            <Text style={[styles.filterChipText, selected && styles.filterChipTextSelected]}>
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** Fixed-height scrollable picker so long lists don’t blow up the page. */
export function SelectList({
  children,
  maxHeight = 200,
  emptyLabel = 'No results',
  count,
}: {
  children: React.ReactNode;
  maxHeight?: number;
  emptyLabel?: string;
  count?: number;
}) {
  const empty = count === 0;
  return (
    <View style={[styles.selectList, { maxHeight }]}>
      {empty ? (
        <View style={{ padding: 12 }}>
          <Muted>{emptyLabel}</Muted>
        </View>
      ) : (
        <ScrollView
          nestedScrollEnabled
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator
        >
          {children}
        </ScrollView>
      )}
    </View>
  );
}

/** One selectable row inside SelectList. */
export function SelectRow({
  label,
  subtitle,
  selected,
  onPress,
  trailing,
}: {
  label: string;
  subtitle?: string;
  selected?: boolean;
  onPress: () => void;
  trailing?: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.selectRow,
        selected && styles.selectRowSelected,
        pressed && { opacity: 0.85 },
      ]}
    >
      <View
        style={[
          styles.selectRadio,
          selected && { borderColor: colors.primary, backgroundColor: colors.primarySoft },
        ]}
      >
        {selected ? <View style={styles.selectRadioDot} /> : null}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          numberOfLines={1}
          style={{
            fontWeight: selected ? '800' : '600',
            fontSize: 14,
            color: selected ? colors.primaryDark : colors.navy,
          }}
        >
          {label}
        </Text>
        {subtitle ? (
          <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing}
    </Pressable>
  );
}

/** Compact summary of current picks. */
export function SelectionSummary({ lines }: { lines: string[] }) {
  const visible = lines.filter(Boolean);
  if (!visible.length) return null;
  return (
    <View style={styles.selectionSummary}>
      {visible.map((line) => (
        <Text key={line} style={styles.selectionSummaryText}>
          {line}
        </Text>
      ))}
    </View>
  );
}

/** Compact text action for dense admin list rows. */
export function TextAction({
  label,
  onPress,
  tone = 'default',
  disabled,
}: {
  label: string;
  onPress: () => void;
  tone?: 'default' | 'danger' | 'muted';
  disabled?: boolean;
}) {
  const color =
    tone === 'danger' ? colors.danger : tone === 'muted' ? colors.muted : colors.primaryDark;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      style={({ pressed }) => ({ opacity: disabled ? 0.4 : pressed ? 0.65 : 1, paddingVertical: 2 })}
    >
      <Text style={{ color, fontFamily: fonts.uiSemi, fontSize: 13, letterSpacing: 0.1 }}>{label}</Text>
    </Pressable>
  );
}

/**
 * Professional manage toolbar for master-data rows:
 * Edit · Deactivate · Delete
 */
export function ManageActionBar({
  onEdit,
  onToggleActive,
  onDelete,
  isActive = true,
  disabled,
}: {
  onEdit: () => void;
  onToggleActive: () => void;
  onDelete: () => void;
  isActive?: boolean;
  disabled?: boolean;
}) {
  return (
    <View style={styles.manageBar}>
      <TextAction label="Edit" onPress={onEdit} disabled={disabled} />
      <Text style={styles.manageSep}>·</Text>
      <TextAction
        label={isActive ? 'Deactivate' : 'Activate'}
        onPress={onToggleActive}
        tone="muted"
        disabled={disabled}
      />
      <Text style={styles.manageSep}>·</Text>
      <TextAction label="Delete" onPress={onDelete} tone="danger" disabled={disabled} />
    </View>
  );
}

/** Primary + secondary form footer (Save / Cancel). */
export function FormActions({
  primaryLabel,
  onPrimary,
  onCancel,
  loading,
  secondary,
}: {
  primaryLabel: string;
  onPrimary: () => void;
  onCancel?: () => void;
  loading?: boolean;
  secondary?: React.ReactNode;
}) {
  return (
    <View style={{ marginTop: spacing.xs }}>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        {onCancel ? (
          <View style={{ flex: 1 }}>
            <Button label="Cancel" variant="secondary" onPress={onCancel} disabled={loading} />
          </View>
        ) : null}
        <View style={{ flex: 1 }}>
          <Button label={primaryLabel} onPress={onPrimary} loading={loading} />
        </View>
      </View>
      {secondary}
    </View>
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
      <Text style={{ color, fontFamily: fonts.uiSemi, fontSize: 12 }}>{label}</Text>
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
  const navigation = useNavigation<any>();
  const olderLabel = older?.code || 'older stock';
  const friendlyMessage =
    message?.includes('FIFO VIOLATION') || message?.includes('Older stock is available')
      ? 'This item has older stock that should be used first. Open the older stock below, then withdraw that instead.'
      : message;

  const openOlderStock = () => {
    if (!older?.id) return;
    const isUnit = older.kind === 'UNIT';
    // Dispatch at root so the Inventory tab is selected even when opened from Withdrawal/Scanner.
    navigation.dispatch(
      CommonActions.navigate({
        name: 'Inventory',
        params: {
          screen: isUnit ? 'UnitDetail' : 'BatchDetail',
          params: { id: older.id },
        },
      })
    );
  };

  return (
    <View style={styles.fifo}>
      <Text style={styles.fifoTitle}>Use older stock first</Text>
      <Text style={styles.fifoMsg}>{friendlyMessage}</Text>
      {older ? (
        <Text style={[styles.fifoMsg, { marginTop: 8 }]}>
          Older stock: {older.code}
          {'\n'}
          Received: {String(older.grn_date).slice(0, 10)} · Qty: {older.available_qty}
          {'\n'}
          Location: {[older.warehouse, older.rack, older.shelf, older.position].filter(Boolean).join('/') || '—'}
        </Text>
      ) : null}
      {older?.id ? (
        <View style={{ marginTop: 10 }}>
          <Button label={`Open ${olderLabel}`} onPress={openOlderStock} />
        </View>
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
    borderWidth: 1,
    borderColor: colors.borderSoft,
    ...shadow.soft,
  },
  cardPad: { padding: spacing.md },
  title: {
    fontFamily: fonts.display,
    fontSize: 28,
    color: colors.navy,
    letterSpacing: -0.5,
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontFamily: fonts.uiSemi,
    fontSize: 16,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  sectionLabel: {
    fontFamily: fonts.uiSemi,
    fontSize: 12,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },
  muted: {
    fontFamily: fonts.ui,
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
  },
  fieldLabel: {
    fontFamily: fonts.uiSemi,
    fontSize: 13,
    color: colors.navy,
    marginBottom: 6,
  },
  button: {
    minHeight: 50,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    marginVertical: spacing.xs,
  },
  buttonText: { fontFamily: fonts.uiBold, fontSize: 16 },
  tile: {
    width: '48%',
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  tileIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  tileTitle: { fontFamily: fonts.uiBold, fontSize: 15, marginBottom: 4 },
  tileSub: { fontFamily: fonts.ui, color: colors.muted, fontSize: 12, lineHeight: 16 },
  metric: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    minWidth: '30%',
    borderWidth: 1,
    borderColor: colors.borderSoft,
    overflow: 'hidden',
    ...shadow.soft,
  },
  metricAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    backgroundColor: colors.primary,
  },
  metricValue: {
    fontFamily: fonts.displaySemi,
    fontSize: 22,
    color: colors.navy,
    letterSpacing: -0.4,
  },
  metricLabel: {
    fontFamily: fonts.uiMedium,
    fontSize: 12,
    color: colors.muted,
    marginTop: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.borderSoft,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    marginBottom: spacing.sm,
    color: colors.text,
    fontSize: 16,
    fontFamily: fonts.ui,
  },
  searchWrap: {
    position: 'relative',
    justifyContent: 'center',
    ...shadow.soft,
    borderRadius: radius.xl,
  },
  searchIconSlot: {
    position: 'absolute',
    left: 16,
    top: 0,
    bottom: 0,
    zIndex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchInput: {
    marginBottom: 0,
    paddingLeft: 46,
    paddingRight: 44,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    borderColor: colors.borderSoft,
    minHeight: 52,
  },
  searchClear: {
    position: 'absolute',
    right: 10,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchTrailing: {
    position: 'absolute',
    right: 8,
    top: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  searchFilterBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  searchFilterBtnOpen: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primary,
  },
  searchFilterBtnActive: {
    borderColor: colors.primary,
  },
  searchFilterDot: {
    position: 'absolute',
    top: 5,
    right: 5,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.accent,
    borderWidth: 1,
    borderColor: colors.surface,
  },
  filterChipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingRight: 8,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  filterChipSelected: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primary,
  },
  filterChipText: {
    color: colors.muted,
    fontSize: 13,
    fontFamily: fonts.uiMedium,
  },
  filterChipTextSelected: {
    color: colors.primaryDark,
    fontFamily: fonts.uiSemi,
  },
  searchClearBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchClearX: {
    color: colors.navy,
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 20,
    marginTop: -1,
  },
  selectList: {
    borderWidth: 1,
    borderColor: colors.borderSoft,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    overflow: 'hidden',
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
    paddingVertical: 2,
  },
  selectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSoft,
  },
  selectRowSelected: {
    backgroundColor: colors.primarySoft,
  },
  selectRadio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectRadioDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  selectionSummary: {
    backgroundColor: colors.primarySoft,
    borderRadius: radius.md,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: spacing.sm,
    gap: 4,
  },
  selectionSummaryText: {
    color: colors.primaryDark,
    fontWeight: '700',
    fontSize: 13,
  },
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
  },
  manageBar: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSoft,
  },
  manageSep: {
    color: colors.border,
    fontSize: 13,
    fontWeight: '600',
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: spacing.lg },
  fifo: {
    backgroundColor: colors.warningSoft,
    borderRadius: radius.md,
    padding: spacing.md,
    marginVertical: spacing.sm,
  },
  fifoTitle: {
    color: colors.warning,
    fontFamily: fonts.uiBold,
    marginBottom: 4,
  },
  fifoMsg: {
    color: colors.text,
    fontFamily: fonts.ui,
    lineHeight: 20,
  },
});
