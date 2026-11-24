import React from 'react';
import { Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BrandMark } from './BrandMark';
import { colors, fonts, spacing } from '../theme/tokens';

type PageHeaderProps = {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  /** When true, include top safe-area padding (tab roots with native header hidden). */
  safeTop?: boolean;
  style?: ViewStyle;
};

/** In-screen title block — ALSTEF mark + title, left-aligned. */
export function PageHeader({ title, subtitle, right, safeTop = false, style }: PageHeaderProps) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.wrap,
        safeTop && { paddingTop: Math.max(insets.top, 8) + 4 },
        style,
      ]}
    >
      <View style={styles.row}>
        <BrandMark size="md" style={styles.mark} />
        <View style={styles.textCol}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={styles.subtitle} numberOfLines={2}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {right ? <View style={styles.right}>{right}</View> : null}
      </View>
    </View>
  );
}

type NavHeaderProps = {
  title?: string;
  subtitle?: string;
  canGoBack?: boolean;
  onBack?: () => void;
  right?: React.ReactNode;
};

/** Stack navigator header — ALSTEF mark on every stack page. */
export function NavHeader({ title, subtitle, canGoBack, onBack, right }: NavHeaderProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.navWrap, { paddingTop: Math.max(insets.top, 8) }]}>
      <View style={styles.navRow}>
        {canGoBack ? (
          <Pressable
            onPress={onBack}
            hitSlop={10}
            accessibilityLabel="Go back"
            style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.65 : 1 }]}
          >
            <Text style={styles.backChevron}>‹</Text>
          </Pressable>
        ) : (
          <BrandMark size="sm" style={styles.navMark} />
        )}
        <View style={styles.textCol}>
          <View style={styles.navTitleRow}>
            {canGoBack ? <BrandMark size="sm" style={styles.navMarkInline} /> : null}
            <Text style={styles.navTitle} numberOfLines={1}>
              {title || ''}
            </Text>
          </View>
          {subtitle ? (
            <Text style={styles.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {right ? <View style={styles.right}>{right}</View> : <View style={styles.backSpacer} />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.background,
    paddingBottom: spacing.sm,
    marginBottom: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  mark: {
    marginTop: 2,
  },
  textCol: { flex: 1, minWidth: 0 },
  title: {
    fontFamily: fonts.display,
    fontSize: 28,
    letterSpacing: -0.6,
    color: colors.navy,
  },
  navTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
  },
  navTitle: {
    flex: 1,
    fontFamily: fonts.displaySemi,
    fontSize: 18,
    letterSpacing: -0.3,
    color: colors.navy,
  },
  subtitle: {
    fontFamily: fonts.ui,
    fontSize: 13,
    lineHeight: 18,
    color: colors.muted,
    marginTop: 4,
  },
  right: { paddingTop: 0 },
  navWrap: {
    backgroundColor: colors.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSoft,
    paddingBottom: 10,
    paddingHorizontal: spacing.md,
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 40,
  },
  navMark: {
    marginRight: 6,
  },
  navMarkInline: {
    flexShrink: 0,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    marginRight: 6,
  },
  backChevron: {
    fontFamily: fonts.displaySemi,
    fontSize: 28,
    color: colors.navy,
    marginTop: -2,
    lineHeight: 32,
  },
  backSpacer: { width: 8 },
});
