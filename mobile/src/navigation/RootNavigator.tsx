import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { colors } from '../theme/tokens';

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

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function InventoryStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="InventoryList" component={InventoryListScreen} options={{ title: 'Inventory' }} />
      <Stack.Screen name="BatchDetail" component={BatchDetailScreen} options={{ title: 'Batch' }} />
      <Stack.Screen name="UnitDetail" component={UnitDetailScreen} options={{ title: 'Unit' }} />
    </Stack.Navigator>
  );
}

function GRNStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="GRNList" component={GRNListScreen} options={{ title: 'GRN' }} />
      <Stack.Screen name="GRNDetail" component={GRNDetailScreen} options={{ title: 'GRN Detail' }} />
      <Stack.Screen name="GRNImport" component={GRNImportScreen} options={{ title: 'Import GRN' }} />
    </Stack.Navigator>
  );
}

function WarehouseStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="WarehouseList" component={WarehouseListScreen} options={{ title: 'Warehouses' }} />
      <Stack.Screen name="RackDetail" component={RackDetailScreen} options={{ title: 'Rack' }} />
      <Stack.Screen name="Allocate" component={AllocateScreen} options={{ title: 'Allocate' }} />
      <Stack.Screen name="Transfer" component={TransferScreen} options={{ title: 'Transfer' }} />
    </Stack.Navigator>
  );
}

function WithdrawalStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="WithdrawalMain" component={WithdrawalScreen} options={{ title: 'Withdrawal' }} />
      <Stack.Screen name="WithdrawalConfirm" component={WithdrawalConfirmScreen} options={{ title: 'Confirmed' }} />
    </Stack.Navigator>
  );
}

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarStyle: { height: 60, paddingBottom: 8 },
      }}
    >
      <Tab.Screen name="Dashboard" component={DashboardScreen} />
      <Tab.Screen name="Inventory" component={InventoryStack} />
      <Tab.Screen name="GRN" component={GRNStack} />
      <Tab.Screen name="Scanner" component={ScannerScreen} options={{ headerShown: true }} />
      <Tab.Screen name="Warehouse" component={WarehouseStack} />
      <Tab.Screen name="Withdrawal" component={WithdrawalStack} />
      <Tab.Screen name="Reports" component={ReportsScreen} options={{ headerShown: true }} />
      <Tab.Screen name="Settings" component={SettingsScreen} options={{ headerShown: true }} />
    </Tab.Navigator>
  );
}

export default function RootNavigator() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={colors.primary} />
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
