import React from 'react';
import { View } from 'react-native';
import Svg, { Circle, Path, Rect, G, Line } from 'react-native-svg';
import { colors } from '../theme/tokens';

type IconProps = {
  size?: number;
  color?: string;
};

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

export function CubeIcon({ size = 24, color = colors.navy }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z"
        stroke={color}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
      <Path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" stroke={color} strokeWidth={1.8} strokeLinejoin="round" />
    </Svg>
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

const TAB_ICONS = {
  Dashboard: HomeIcon,
  Scanner: ScanIcon,
  Inventory: CubeIcon,
  Withdrawal: OutIcon,
  GRN: DocIcon,
  Warehouse: RackIcon,
  Reports: ChartIcon,
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

export const MORE_LINK_ICONS = {
  scan: ScanIcon,
  withdraw: OutIcon,
  warehouse: RackIcon,
  grn: DocIcon,
  inventory: CubeIcon,
  reports: ChartIcon,
  settings: GearIcon,
} as const;
