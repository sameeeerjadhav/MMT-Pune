import React, { useMemo } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { ActivityIndicator, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { colors } from '../theme/tokens';
import { canAccessTab, primaryTabsForRole } from '../utils/roles';

import LoginScreen from '../screens/LoginScreen';
import DashboardScreen from '../screens/DashboardScreen';
import InventoryListScreen from '../screens/InventoryListScreen';
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
import WithdrawalScreen, { WithdrawalConfirmScreen } from '../screens/WithdrawalScreen';
import ReportsScreen from '../screens/ReportsScreen';
import SettingsScreen from '../screens/SettingsScreen';
import MoreScreen from '../screens/MoreScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

const stackScreenOptions = {
  headerStyle: { backgroundColor: colors.background },
  headerShadowVisible: false,
  headerTintColor: colors.navy,
  headerTitleStyle: { fontWeight: '700' as const },
  contentStyle: { backgroundColor: colors.background },
};

function InventoryStack() {
  return (
    <Stack.Navigator screenOptions={stackScreenOptions}>
      <Stack.Screen name="InventoryList" component={InventoryListScreen} options={{ title: 'Inventory' }} />
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
      <Stack.Screen name="WarehouseList" component={WarehouseListScreen} options={{ title: 'Warehouses' }} />
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
  icon: keyof typeof Ionicons.glyphMap;
  iconOutline: keyof typeof Ionicons.glyphMap;
  headerShown?: boolean;
};

const TAB_DEFS: TabDef[] = [
  {
    name: 'Dashboard',
    title: 'Home',
    component: DashboardScreen,
    icon: 'home',
    iconOutline: 'home-outline',
  },
  {
    name: 'Scanner',
    title: 'Scan',
    component: ScannerScreen,
    icon: 'scan',
    iconOutline: 'scan-outline',
    headerShown: true,
  },
  {
    name: 'Inventory',
    title: 'Stock',
    component: InventoryStack,
    icon: 'cube',
    iconOutline: 'cube-outline',
  },
  {
    name: 'Withdrawal',
    title: 'Out',
    component: WithdrawalStack,
    icon: 'exit',
    iconOutline: 'exit-outline',
  },
  {
    name: 'GRN',
    title: 'GRN',
    component: GRNStack,
    icon: 'document-text',
    iconOutline: 'document-text-outline',
  },
  {
    name: 'Warehouse',
    title: 'Racks',
    component: WarehouseStack,
    icon: 'grid',
    iconOutline: 'grid-outline',
  },
  {
    name: 'Reports',
    title: 'Reports',
    component: ReportsScreen,
    icon: 'bar-chart',
    iconOutline: 'bar-chart-outline',
    headerShown: true,
  },
  {
    name: 'Settings',
    title: 'Settings',
    component: SettingsScreen,
    icon: 'settings',
    iconOutline: 'settings-outline',
    headerShown: true,
  },
  {
    name: 'More',
    title: 'More',
    component: MoreScreen,
    icon: 'menu',
    iconOutline: 'menu-outline',
  },
];

function MainTabs() {
  const { user } = useAuth();
  const visible = useMemo(() => new Set(primaryTabsForRole(user?.role)), [user?.role]);

  // Only register tabs the role may access. Extra allowed tabs stay hidden for deep links / More.
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
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.tabInactive,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
        tabBarStyle: {
          height: 64,
          paddingBottom: 8,
          paddingTop: 6,
          backgroundColor: colors.surface,
          borderTopColor: colors.borderSoft,
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
              headerShown: !!tab.headerShown && show,
              tabBarButton: show ? undefined : () => null,
              tabBarIcon: ({ focused, color, size }) => (
                <Ionicons name={focused ? tab.icon : tab.iconOutline} size={size} color={color} />
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
