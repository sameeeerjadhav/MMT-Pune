import React, { useMemo } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { ActivityIndicator, Platform, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { TabGlyph } from '../components/icons';
import { colors } from '../theme/tokens';
import { canAccessTab, primaryTabsForRole } from '../utils/roles';

import LoginScreen from '../screens/LoginScreen';
import DashboardScreen from '../screens/DashboardScreen';
import InventoryListScreen from '../screens/InventoryListScreen';
import ItemMasterScreen from '../screens/ItemMasterScreen';
import BatchDetailScreen from '../screens/BatchDetailScreen';
import UnitDetailScreen from '../screens/UnitDetailScreen';
import GRNListScreen from '../screens/GRNListScreen';
import GRNDetailScreen from '../screens/GRNDetailScreen';
import GRNImportScreen from '../screens/GRNImportScreen';
import ScannerScreen from '../screens/ScannerScreen';
import {
  AllocateScreen,
  RackDetailScreen,
  TransferScreen,
  WarehouseListScreen,
} from '../screens/WarehouseScreens';
import RackMapScreen from '../screens/RackMapScreen';
import WithdrawalScreen from '../screens/WithdrawalScreen';
import WithdrawalConfirmScreen from '../screens/WithdrawalConfirmScreen';
import ReportsScreen from '../screens/ReportsScreen';
import SettingsScreen from '../screens/SettingsScreen';
import MoreScreen from '../screens/MoreScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

export const stackScreenOptions = {
  headerStyle: { backgroundColor: colors.surface },
  headerShadowVisible: false,
  headerTintColor: colors.navy,
  headerTitleStyle: { fontWeight: '700' as const, fontSize: 17 },
  headerTitleAlign: 'center' as const,
  contentStyle: { backgroundColor: colors.background },
  headerBackTitleVisible: false,
};

function InventoryStack() {
  return (
    <Stack.Navigator screenOptions={stackScreenOptions}>
      <Stack.Screen name="InventoryList" component={InventoryListScreen} options={{ title: 'Inventory' }} />
      <Stack.Screen name="ItemMaster" component={ItemMasterScreen} options={{ title: 'Items' }} />
      <Stack.Screen name="BatchDetail" component={BatchDetailScreen} options={{ title: 'Batch' }} />
      <Stack.Screen name="UnitDetail" component={UnitDetailScreen} options={{ title: 'Unit' }} />
    </Stack.Navigator>
  );
}

function GRNStack() {
  return (
    <Stack.Navigator screenOptions={stackScreenOptions}>
      <Stack.Screen name="GRNList" component={GRNListScreen} options={{ title: 'GRN' }} />
      <Stack.Screen name="GRNDetail" component={GRNDetailScreen} options={{ title: 'GRN Detail' }} />
      <Stack.Screen name="GRNImport" component={GRNImportScreen} options={{ title: 'Import GRN' }} />
    </Stack.Navigator>
  );
}

function WarehouseStack() {
  return (
    <Stack.Navigator screenOptions={stackScreenOptions}>
      <Stack.Screen name="WarehouseList" component={WarehouseListScreen} options={{ title: 'Racks' }} />
      <Stack.Screen name="RackMap" component={RackMapScreen} options={{ title: 'Rack map' }} />
      <Stack.Screen name="RackDetail" component={RackDetailScreen} options={{ title: 'Rack' }} />
      <Stack.Screen name="Allocate" component={AllocateScreen} options={{ title: 'Allocate' }} />
      <Stack.Screen name="Transfer" component={TransferScreen} options={{ title: 'Transfer' }} />
    </Stack.Navigator>
  );
}

function WithdrawalStack() {
  return (
    <Stack.Navigator screenOptions={stackScreenOptions}>
      <Stack.Screen name="WithdrawalMain" component={WithdrawalScreen} options={{ title: 'Withdrawal' }} />
      <Stack.Screen name="WithdrawalConfirm" component={WithdrawalConfirmScreen} options={{ title: 'Confirmed' }} />
    </Stack.Navigator>
  );
}

type TabDef = {
  name: string;
  title: string;
  component: React.ComponentType<any>;
  /** Nested stack already owns the top bar */
  isStack?: boolean;
};

const TAB_DEFS: TabDef[] = [
  { name: 'Dashboard', title: 'Home', component: DashboardScreen },
  { name: 'Scanner', title: 'Scanner', component: ScannerScreen },
  { name: 'Inventory', title: 'Stock', component: InventoryStack, isStack: true },
  { name: 'Withdrawal', title: 'Out', component: WithdrawalStack, isStack: true },
  { name: 'GRN', title: 'GRN', component: GRNStack, isStack: true },
  { name: 'Warehouse', title: 'Racks', component: WarehouseStack, isStack: true },
  { name: 'Reports', title: 'Reports', component: ReportsScreen },
  { name: 'Settings', title: 'Settings', component: SettingsScreen },
  { name: 'More', title: 'More', component: MoreScreen },
];

function MainTabs() {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const visible = useMemo(() => new Set(primaryTabsForRole(user?.role)), [user?.role]);
  // Gesture nav often reports 0 inset in Expo Go — keep a floor so labels aren't covered.
  const bottomInset = Math.max(insets.bottom, Platform.OS === 'android' ? 18 : 0);

  const ordered = useMemo(() => {
    const allowed = TAB_DEFS.filter((t) => canAccessTab(user?.role, t.name));
    const primary = primaryTabsForRole(user?.role)
      .map((name) => allowed.find((t) => t.name === name))
      .filter(Boolean) as TabDef[];
    const hidden = allowed.filter((t) => !visible.has(t.name));
    return [...primary, ...hidden];
  }, [user?.role, visible]);

  return (
    <Tab.Navigator
      safeAreaInsets={{ bottom: bottomInset }}
      screenOptions={{
        headerShown: true,
        headerStyle: stackScreenOptions.headerStyle,
        headerShadowVisible: stackScreenOptions.headerShadowVisible,
        headerTintColor: stackScreenOptions.headerTintColor,
        headerTitleStyle: stackScreenOptions.headerTitleStyle,
        headerTitleAlign: stackScreenOptions.headerTitleAlign,
        tabBarHideOnKeyboard: true,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.tabInactive,
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '700',
          marginBottom: 2,
        },
        tabBarIconStyle: {
          marginTop: 2,
        },
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.borderSoft,
          borderTopWidth: 1,
          elevation: 12,
          shadowColor: '#0B1F33',
          shadowOpacity: 0.1,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: -3 },
          // Keep bar in normal layout (not absolute) so it never steals taps from forms.
          height: 56 + bottomInset,
          paddingTop: 6,
          paddingBottom: bottomInset,
        },
      }}
    >
      {ordered.map((tab) => {
        const show = visible.has(tab.name);
        return (
          <Tab.Screen
            key={tab.name}
            name={tab.name}
            component={tab.component}
            options={{
              title: tab.title,
              // Nested stacks provide their own header — avoid double bars.
              headerShown: show ? !tab.isStack : false,
              tabBarLabel: tab.title,
              tabBarButton: show ? undefined : () => null,
              tabBarItemStyle: show ? undefined : { display: 'none' },
              tabBarIcon: ({ focused, color }) => (
                <TabGlyph name={tab.name} focused={focused} color={color} size={22} />
              ),
            }}
          />
        );
      })}
    </Tab.Navigator>
  );
}

export default function RootNavigator() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.background,
        }}
      >
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={{ marginTop: 10, color: colors.muted }}>Loading warehouse…</Text>
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {user ? (
          <Stack.Screen name="Main" component={MainTabs} />
        ) : (
          <Stack.Screen name="Login" component={LoginScreen} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
