import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, spacing } from '../theme/tokens';

type BoneProps = {
  width?: number | `${number}%`;
  height?: number;
  radius?: number;
  style?: ViewStyle;
};

/** Single pulsing bone used to compose page skeletons. */
export function SkeletonBone({
  width = '100%',
  height = 14,
  radius: r = radius.sm,
  style,
}: BoneProps) {
  const opacity = useRef(new Animated.Value(0.45)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.9,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.4,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={[
        styles.bone,
        {
          width,
          height,
          borderRadius: r,
          opacity,
        },
        style,
      ]}
    />
  );
}

function RowCardSkeleton() {
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <SkeletonBone width={56} height={56} radius={14} />
        <View style={styles.rowBody}>
          <View style={styles.rowTop}>
            <SkeletonBone width="55%" height={16} />
            <SkeletonBone width={52} height={22} radius={radius.pill} />
          </View>
          <SkeletonBone width="72%" height={13} style={{ marginTop: 8 }} />
          <SkeletonBone width="48%" height={12} style={{ marginTop: 8 }} />
        </View>
      </View>
    </View>
  );
}

/** Stock / users / GRN style list placeholder. */
export function ListSkeleton({
  rows = 6,
  showSearch = true,
  titleWidth = '34%',
}: {
  rows?: number;
  showSearch?: boolean;
  titleWidth?: number | `${number}%`;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.screen, { paddingTop: Math.max(insets.top, 8) + 4 }]}>
      <SkeletonBone width={titleWidth} height={28} radius={10} />
      {showSearch ? (
        <SkeletonBone
          width="100%"
          height={52}
          radius={radius.xl}
          style={{ marginTop: spacing.md, marginBottom: spacing.sm }}
        />
      ) : (
        <View style={{ height: spacing.md }} />
      )}
      {Array.from({ length: rows }).map((_, i) => (
        <RowCardSkeleton key={i} />
      ))}
    </View>
  );
}

/** Home dashboard placeholder matching hero + tiles. */
export function DashboardSkeleton() {
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.root}>
      <View style={[styles.hero, { paddingTop: Math.max(insets.top, 12) + 8 }]}>
        <SkeletonBone width={72} height={12} radius={6} style={{ backgroundColor: 'rgba(255,255,255,0.35)' }} />
        <SkeletonBone
          width="62%"
          height={28}
          radius={10}
          style={{ marginTop: 10, backgroundColor: 'rgba(255,255,255,0.4)' }}
        />
        <View style={styles.heroMetrics}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={styles.heroMetric}>
              <SkeletonBone width={40} height={18} style={{ backgroundColor: 'rgba(255,255,255,0.4)' }} />
              <SkeletonBone
                width={54}
                height={10}
                style={{ marginTop: 6, backgroundColor: 'rgba(255,255,255,0.28)' }}
              />
            </View>
          ))}
        </View>
      </View>
      <View style={styles.body}>
        <SkeletonBone width={96} height={12} style={{ marginBottom: spacing.sm }} />
        <View style={styles.tileGrid}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={styles.tile}>
              <SkeletonBone width={36} height={36} radius={12} />
              <SkeletonBone width="70%" height={14} style={{ marginTop: 10 }} />
              <SkeletonBone width="50%" height={11} style={{ marginTop: 8 }} />
            </View>
          ))}
        </View>
        <SkeletonBone width={120} height={12} style={{ marginTop: spacing.md, marginBottom: spacing.sm }} />
        <View style={styles.card}>
          <SkeletonBone width="40%" height={22} radius={radius.pill} />
          <SkeletonBone width="90%" height={14} style={{ marginTop: 12 }} />
          <SkeletonBone width="70%" height={12} style={{ marginTop: 8 }} />
        </View>
        <View style={styles.card}>
          <SkeletonBone width="55%" height={14} />
          <SkeletonBone width="40%" height={12} style={{ marginTop: 10 }} />
        </View>
      </View>
    </View>
  );
}

/** Batch / unit / GRN detail placeholder. */
export function DetailSkeleton() {
  return (
    <View style={styles.screen}>
      <SkeletonBone width="48%" height={22} />
      <SkeletonBone width="70%" height={14} style={{ marginTop: 10 }} />
      <View style={[styles.card, { marginTop: spacing.md }]}>
        <SkeletonBone width="35%" height={12} />
        <SkeletonBone width="80%" height={16} style={{ marginTop: 12 }} />
        <SkeletonBone width="60%" height={14} style={{ marginTop: 10 }} />
        <SkeletonBone width="50%" height={14} style={{ marginTop: 10 }} />
      </View>
      <View style={styles.card}>
        <SkeletonBone width="40%" height={12} />
        <SkeletonBone width="100%" height={44} radius={radius.md} style={{ marginTop: 12 }} />
        <SkeletonBone width="100%" height={44} radius={radius.md} style={{ marginTop: 10 }} />
      </View>
    </View>
  );
}

/** Floors / map-style placeholder. */
export function MapSkeleton() {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.screen, { paddingTop: Math.max(insets.top, 8) + 4 }]}>
      <SkeletonBone width="28%" height={28} radius={10} />
      <SkeletonBone
        width="100%"
        height={52}
        radius={radius.xl}
        style={{ marginTop: spacing.md, marginBottom: spacing.sm }}
      />
      <View style={styles.card}>
        <SkeletonBone width="40%" height={14} />
        <View style={styles.chipRow}>
          {[0, 1, 2].map((i) => (
            <SkeletonBone key={i} width={88} height={34} radius={radius.sm} />
          ))}
        </View>
      </View>
      {[0, 1, 2, 3].map((i) => (
        <View key={i} style={styles.card}>
          <SkeletonBone width="45%" height={16} />
          <SkeletonBone width="65%" height={12} style={{ marginTop: 10 }} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  screen: {
    flex: 1,
    backgroundColor: colors.background,
    padding: spacing.md,
  },
  bone: {
    backgroundColor: colors.borderSoft,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  row: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  rowBody: { flex: 1 },
  rowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  hero: {
    backgroundColor: colors.heroFrom,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
  },
  heroMetrics: {
    marginTop: spacing.lg,
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: radius.lg,
    paddingVertical: 16,
  },
  heroMetric: { flex: 1, alignItems: 'center' },
  body: { padding: spacing.md, paddingTop: spacing.lg },
  tileGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  tile: {
    width: '48%',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  chipRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
    flexWrap: 'wrap',
  },
});
