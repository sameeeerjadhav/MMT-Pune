import React from 'react';
import { View } from 'react-native';
import Svg, { Circle, Path, Rect, G, Line } from 'react-native-svg';
import { colors } from '../theme/tokens';

type IconProps = {
  size?: number;
  color?: string;
};

export function SearchIcon({ size = 24, color = colors.navy }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="11" cy="11" r="6.5" stroke={color} strokeWidth={1.8} />
      <Path d="M16.5 16.5L21 21" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}

export function BellIcon({ size = 24, color = colors.navy }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M6 9.5a6 6 0 0 1 12 0c0 4 1.5 5.5 1.5 5.5H4.5S6 13.5 6 9.5z"
        stroke={color}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
      <Path d="M10 18.5a2 2 0 0 0 4 0" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}

export function PinIcon({ size = 24, color = colors.navy }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 21s6-5.2 6-11a6 6 0 1 0-12 0c0 5.8 6 11 6 11z"
        stroke={color}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
      <Circle cx="12" cy="10" r="2.2" stroke={color} strokeWidth={1.8} />
    </Svg>
  );
}

/** Funnel / filter glyph for search-bar filter dropdown. */
export function FilterIcon({ size = 24, color = colors.navy }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 6h16l-6.5 7.5V19l-3 1.5v-7L4 6z"
        stroke={color}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function HomeIcon({ size = 24, color = colors.navy }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 10.5L12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5z"
        stroke={color}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function ScanIcon({ size = 24, color = colors.navy }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M4 8V5a1 1 0 0 1 1-1h3" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
      <Path d="M16 4h3a1 1 0 0 1 1 1v3" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
      <Path d="M20 16v3a1 1 0 0 1-1 1h-3" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
      <Path d="M8 20H5a1 1 0 0 1-1-1v-3" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
      <Line x1="6" y1="12" x2="18" y2="12" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}

/** Simple outline cube — tab bar / nav (original look). */
export function CubeIcon({ size = 24, color = colors.navy }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z"
        stroke={color}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
      <Path
        d="M12 12l8-4.5M12 12v9M12 12L4 7.5"
        stroke={color}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/**
 * Filled isometric cube for stock list defaults (SVG only — no photo asset).
 * Thin stroke; pale faces; transparent outside.
 */
export function StockCubeIcon({ size = 24, color = colors.primary }: IconProps) {
  const stroke = Math.max(1.1, Math.min(1.5, size / 52));
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      <Path d="M24 6L40 15L24 24L8 15L24 6Z" fill={colors.primarySoft} stroke={color} strokeWidth={stroke} strokeLinejoin="round" />
      <Path d="M8 15V33L24 42V24L8 15Z" fill={colors.primarySoft} stroke={color} strokeWidth={stroke} strokeLinejoin="round" />
      <Path d="M40 15V33L24 42V24L40 15Z" fill="#D7E8F7" stroke={color} strokeWidth={stroke} strokeLinejoin="round" />
    </Svg>
  );
}

/** Default stock photo placeholder: large cube, no tile / shadow / background. */
export function StockLogo({ size = 72 }: { size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'transparent',
      }}
    >
      <StockCubeIcon size={size} color={colors.primary} />
    </View>
  );
}

export function OutIcon({ size = 24, color = colors.navy }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M9 6H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" stroke={color} strokeWidth={1.8} />
      <Path d="M14 4h6v6" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M20 4L11 13" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}

export function DocIcon({ size = 24, color = colors.navy }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"
        stroke={color}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
      <Path d="M14 3v5h5" stroke={color} strokeWidth={1.8} strokeLinejoin="round" />
      <Path d="M9 13h6M9 17h6" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}

export function RackIcon({ size = 24, color = colors.navy }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="3" y="4" width="18" height="4" rx="1" stroke={color} strokeWidth={1.8} />
      <Rect x="3" y="10" width="18" height="4" rx="1" stroke={color} strokeWidth={1.8} />
      <Rect x="3" y="16" width="18" height="4" rx="1" stroke={color} strokeWidth={1.8} />
      <Path d="M7 4v16M17 4v16" stroke={color} strokeWidth={1.8} />
    </Svg>
  );
}

export function ChartIcon({ size = 24, color = colors.navy }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M4 19V5" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
      <Path d="M4 19h16" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
      <Rect x="7" y="11" width="3" height="6" rx="0.5" fill={color} />
      <Rect x="12" y="7" width="3" height="10" rx="0.5" fill={color} />
      <Rect x="17" y="9" width="3" height="8" rx="0.5" fill={color} />
    </Svg>
  );
}

export function GearIcon({ size = 24, color = colors.navy }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="3" stroke={color} strokeWidth={1.8} />
      <Path
        d="M12 3.5v2.2M12 18.3v2.2M4.9 6.5l1.6 1.6M17.5 15.9l1.6 1.6M3.5 12h2.2M18.3 12h2.2M4.9 17.5l1.6-1.6M17.5 8.1l1.6-1.6"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </Svg>
  );
}

export function MenuIcon({ size = 24, color = colors.navy }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M5 7h14M5 12h14M5 17h14" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}

export function LogoutIcon({ size = 24, color = colors.danger }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M10 6H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h4" stroke={color} strokeWidth={1.8} />
      <Path
        d="M14 8l4 4-4 4M18 12H9"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function UserIcon({ size = 24, color = colors.navy }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="8" r="3.5" stroke={color} strokeWidth={1.8} />
      <Path d="M5 19c1.5-3.2 4-5 7-5s5.5 1.8 7 5" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}

/** Filled person-in-circle avatar (dashboard profile control). No outer ring. */
export function UserAvatarIcon({
  size = 40,
  color = '#fff',
  backgroundColor = '#4A4A4A',
}: IconProps & { backgroundColor?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      <Circle cx="24" cy="24" r="24" fill={backgroundColor} />
      <Circle cx="24" cy="16.5" r="7.2" fill={color} />
      <Path
        d="M11 42.2c0-7.6 5.8-12.7 13-12.7s13 5.1 13 12.7c-3.4 2.4-8 3.6-13 3.6s-9.6-1.2-13-3.6z"
        fill={color}
      />
    </Svg>
  );
}

export function CameraIcon({ size = 24, color = colors.navy }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="3" y="7" width="18" height="13" rx="2" stroke={color} strokeWidth={1.8} />
      <Path d="M8 7l1.5-3h5L16 7" stroke={color} strokeWidth={1.8} strokeLinejoin="round" />
      <Circle cx="12" cy="13.5" r="3.2" stroke={color} strokeWidth={1.8} />
    </Svg>
  );
}

export function EmptyBoxIcon({ size = 72, color = colors.primary }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 72 72" fill="none">
      <G opacity={0.9}>
        <Path
          d="M12 24l24-12 24 12v28L36 64 12 52V24z"
          fill={colors.primarySoft}
          stroke={color}
          strokeWidth={2}
          strokeLinejoin="round"
        />
        <Path d="M12 24l24 12 24-12M36 36v28" stroke={color} strokeWidth={2} strokeLinejoin="round" />
      </G>
    </Svg>
  );
}

export function ScanHeroIcon({ size = 88, color = colors.primary }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 88 88" fill="none">
      <Rect x="14" y="18" width="60" height="52" rx="10" fill={colors.primarySoft} />
      <Rect x="14" y="18" width="60" height="52" rx="10" stroke={color} strokeWidth={2.2} />
      <Path d="M28 30h12M48 30h12M28 58h12M48 58h12" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
      <Line x1="24" y1="44" x2="64" y2="44" stroke={colors.accent} strokeWidth={3} strokeLinecap="round" />
      <Circle cx="44" cy="44" r="8" stroke={color} strokeWidth={2.2} />
    </Svg>
  );
}

export function ClipboardIcon({ size = 24, color = colors.navy }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="5" y="5" width="14" height="16" rx="2" stroke={color} strokeWidth={1.8} />
      <Rect x="9" y="3" width="6" height="4" rx="1" stroke={color} strokeWidth={1.8} />
      <Path d="M8.5 13l2.2 2.2L15.5 10.5" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function ShieldIcon({ size = 24, color = colors.navy }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 3l7 3v5.5c0 4.4-2.9 8-7 9.5-4.1-1.5-7-5.1-7-9.5V6l7-3z"
        stroke={color}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
      <Path d="M9 12l2.2 2.2L15 10" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

const TAB_ICONS = {
  Counts: ClipboardIcon,
  Alerts: BellIcon,
  Audit: ShieldIcon,
  Dashboard: HomeIcon,
  Scanner: ScanIcon,
  Inventory: CubeIcon,
  Withdrawal: OutIcon,
  GRN: DocIcon,
  Warehouse: RackIcon,
  Reports: ChartIcon,
  Users: UserIcon,
  Settings: GearIcon,
  More: MenuIcon,
} as const;

export function TabGlyph({
  name,
  focused,
  color,
  size = 22,
}: {
  name: string;
  focused: boolean;
  color: string;
  size?: number;
}) {
  const Icon = TAB_ICONS[name as keyof typeof TAB_ICONS] || MenuIcon;
  return (
    <View
      style={{
        width: 40,
        height: 28,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 10,
        backgroundColor: focused ? colors.primarySoft : 'transparent',
      }}
    >
      <Icon size={size} color={color} />
    </View>
  );
}

/** Open eye — password visible. */
export function EyeIcon({ size = 24, color = colors.navy }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12z"
        stroke={color}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
      <Circle cx="12" cy="12" r="3" stroke={color} strokeWidth={1.8} />
    </Svg>
  );
}

/** Crossed eye — password hidden. */
export function EyeOffIcon({ size = 24, color = colors.navy }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M3 3l18 18"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      <Path
        d="M10.6 6.3A10.4 10.4 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16.4 16.4 0 0 1-3.4 3.8"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M6.7 6.8C4.1 8.5 2.5 12 2.5 12s3.5 6.5 9.5 6.5c1.4 0 2.7-.3 3.9-.8"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M9.9 9.9a3 3 0 0 0 4.2 4.2"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </Svg>
  );
}

export const MORE_LINK_ICONS = {
  scan: ScanIcon,
  withdraw: OutIcon,
  warehouse: RackIcon,
  grn: DocIcon,
  inventory: CubeIcon,
  reports: ChartIcon,
  users: UserIcon,
  settings: GearIcon,
  counts: ClipboardIcon,
  alerts: BellIcon,
  audit: ShieldIcon,
} as const;
