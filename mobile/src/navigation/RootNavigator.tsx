import React, { useMemo } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { TabGlyph } from '../components/icons';
import { BootLoading } from '../components/BootLoading';
import { colors, fonts } from '../theme/tokens';
import { canAccessTab, primaryTabsForRole } from '../utils/roles';
import { stackScreenOptions } from './headerOptions';

import LoginScreen from '../screens/LoginScreen';
import DashboardScreen from '../screens/DashboardScreen';
import ProfileScreen from '../screens/ProfileScreen';
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
import FloorMapScreen from '../screens/FloorMapScreen';
import AllocationDetailScreen from '../screens/AllocationDetailScreen';
import WithdrawalScreen from '../screens/WithdrawalScreen';
import WithdrawalConfirmScreen from '../screens/WithdrawalConfirmScreen';
import ReportsScreen from '../screens/ReportsScreen';
import SettingsScreen from '../screens/SettingsScreen';
import UsersScreen from '../screens/UsersScreen';
import MoreScreen from '../screens/MoreScreen';
import AlertsScreen from '../screens/AlertsScreen';
import AuditLogScreen from '../screens/AuditLogScreen';
import { CountListScreen, CountSessionScreen } from '../screens/CountsScreens';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

export { stackScreenOptions };

function DashboardStack() {
  return (
    <Stack.Navigator screenOptions={stackScreenOptions}>
      <Stack.Screen
        name="DashboardHome"
        component={DashboardScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen name="Profile" component={ProfileScreen} options={{ title: 'My profile' }} />
    </Stack.Navigator>
  );
}

function InventoryStack() {
  return (
    <Stack.Navigator screenOptions={stackScreenOptions}>
      <Stack.Screen
        name="InventoryList"
        component={InventoryListScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen name="ItemMaster" component={ItemMasterScreen} options={{ title: 'Items' }} />
      <Stack.Screen name="BatchDetail" component={BatchDetailScreen} options={{ title: 'Batch' }} />
      <Stack.Screen name="UnitDetail" component={UnitDetailScreen} options={{ title: 'Unit' }} />
    </Stack.Navigator>
  );
}

function GRNStack() {
  return (
    <Stack.Navigator screenOptions={stackScreenOptions}>
      <Stack.Screen name="GRNList" component={GRNListScreen} options={{ headerShown: false }} />
      <Stack.Screen name="GRNDetail" component={GRNDetailScreen} options={{ title: 'GRN Detail' }} />
      <Stack.Screen name="GRNImport" component={GRNImportScreen} options={{ title: 'Import GRN' }} />
    </Stack.Navigator>
  );
}

function WarehouseStack() {
  return (
    <Stack.Navigator screenOptions={stackScreenOptions}>
      <Stack.Screen
        name="WarehouseList"
        component={WarehouseListScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen name="FloorMap" component={FloorMapScreen} options={{ title: 'Floor map' }} />
      <Stack.Screen name="RackMap" component={RackMapScreen} options={{ title: 'Rack map' }} />
      <Stack.Screen name="RackDetail" component={RackDetailScreen} options={{ title: 'Rack' }} />
      <Stack.Screen
        name="AllocationDetail"
        component={AllocationDetailScreen}
        options={{ title: 'Stock details' }}
      />
      <Stack.Screen name="Allocate" component={AllocateScreen} options={{ title: 'Allocate' }} />
      <Stack.Screen name="Transfer" component={TransferScreen} options={{ title: 'Transfer' }} />
    </Stack.Navigator>
  );
}

function WithdrawalStack() {
  return (
    <Stack.Navigator screenOptions={stackScreenOptions}>
      <Stack.Screen
        name="WithdrawalMain"
        component={WithdrawalScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="WithdrawalConfirm"
        component={WithdrawalConfirmScreen}
        options={{ title: 'Confirmed' }}
      />
    </Stack.Navigator>
  );
}

function CountsStack() {
  return (
    <Stack.Navigator screenOptions={stackScreenOptions}>
      <Stack.Screen name="CountList" component={CountListScreen} options={{ headerShown: false }} />
      <Stack.Screen name="CountSession" component={CountSessionScreen} options={{ title: 'Count' }} />
    </Stack.Navigator>
  );
}

type TabDef = {
  name: string;
  title: string;
  component: React.ComponentType<any>;
  isStack?: boolean;
};

const TAB_DEFS: TabDef[] = [
  { name: 'Dashboard', title: 'Home', component: DashboardStack, isStack: true },
  { name: 'Scanner', title: 'Scanner', component: ScannerScreen },
  { name: 'Inventory', title: 'Stock', component: InventoryStack, isStack: true },
  { name: 'Withdrawal', title: 'Out', component: WithdrawalStack, isStack: true },
  { name: 'GRN', title: 'GRN', component: GRNStack, isStack: true },
  { name: 'Warehouse', title: 'Floors', component: WarehouseStack, isStack: true },
  { name: 'Reports', title: 'Reports', component: ReportsScreen },
  { name: 'Users', title: 'Users', component: UsersScreen },
  { name: 'Counts', title: 'Counts', component: CountsStack, isStack: true },
  { name: 'Alerts', title: 'Alerts', component: AlertsScreen },
  { name: 'Audit', title: 'Audit', component: AuditLogScreen },
  { name: 'Settings', title: 'Settings', component: SettingsScreen },
  { name: 'More', title: 'More', component: MoreScreen },
];

function MainTabs() {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const visible = useMemo(() => new Set(primaryTabsForRole(user?.role)), [user?.role]);
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
        headerShown: false,
        tabBarHideOnKeyboard: true,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.tabInactive,
        tabBarLabelStyle: {
          fontFamily: fonts.uiSemi,
          fontSize: 11,
          marginBottom: 2,
        },
        tabBarIconStyle: {
          marginTop: 2,
        },
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.borderSoft,
          borderTopWidth: StyleSheet.hairlineWidth,
          elevation: 8,
          shadowColor: colors.navy,
          shadowOpacity: 0.08,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: -4 },
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
              tabBarLabel: tab.title,
              tabBarButton: show ? undefined : () => null,
              tabBarItemStyle: show ? undefined : { display: 'none' },
              tabBarIcon: ({ focused, color }) => (
                <View
                  style={
                    focused
                      ? {
                          backgroundColor: colors.primarySoft,
                          borderRadius: 12,
                          paddingHorizontal: 10,
                          paddingVertical: 4,
                        }
                      : undefined
                  }
                >
                  <TabGlyph name={tab.name} focused={focused} color={color} size={22} />
                </View>
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
      <BootLoading
        message="Loading warehouse…"
        hint="If this stays blank for more than a few seconds, reload the Expo app."
      />
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
