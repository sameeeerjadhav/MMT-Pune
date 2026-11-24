import React, { useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { inventoryApi } from '../api/endpoints';
import { getErrorMessage, SHOW_DEMO_TOOLS } from '../api/client';
import { CameraIcon, ScanHeroIcon } from '../components/icons';
import { Badge, Button, Card, FifoAlert, Input, Muted, Screen, Subtitle } from '../components/ui';
import { PageHeader } from '../components/PageHeader';
import { useTabScrollPadding } from '../hooks/useTabScrollPadding';
import { colors } from '../theme/tokens';

export default function ScannerScreen({ navigation }: any) {
  const scrollPad = useTabScrollPadding(28);
  const [permission, requestPermission] = useCameraPermissions();
  const [manual, setManual] = useState('');
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');
  const [scanning, setScanning] = useState(true);
  const [loading, setLoading] = useState(false);
  const inFlight = useRef(false);

  const lookup = async (code: string, source: string) => {
    if (!code || inFlight.current) return;
    inFlight.current = true;
    setError('');
    setLoading(true);
    if (source === 'camera') setScanning(false);
    try {
      const { data } = await inventoryApi.scan(code.trim());
      setResult({ ...data, source });
      setScanning(false);
    } catch (e) {
      setError(getErrorMessage(e));
      setResult(null);
      setScanning(false);
    } finally {
      setLoading(false);
      inFlight.current = false;
    }
  };

  return (
    <Screen style={{ padding: 0 }}>
      <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false}
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingBottom: scrollPad }}
        keyboardShouldPersistTaps="handled"
      >
        <PageHeader title="Scanner" safeTop />
        <View style={{ alignItems: 'center', marginBottom: 12 }}>
          <ScanHeroIcon size={72} />
        </View>

        {permission?.granted && scanning ? (
          <View style={{ height: 240, borderRadius: 16, overflow: 'hidden', marginBottom: 12 }}>
            <CameraView
              style={{ flex: 1 }}
              barcodeScannerSettings={{ barcodeTypes: ['code128', 'qr', 'ean13'] }}
              onBarcodeScanned={loading ? undefined : ({ data }) => lookup(data, 'camera')}
            />
          </View>
        ) : (
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <CameraIcon size={22} color={colors.primary} />
              <Muted>Camera {permission?.granted ? 'paused after scan' : 'permission needed'}</Muted>
            </View>
            {!permission?.granted ? <Button label="Enable camera" onPress={requestPermission} /> : null}
            {!scanning ? (
              <Button
                label="Scan again"
                variant="secondary"
                onPress={() => {
                  setScanning(true);
                  setResult(null);
                  setError('');
                }}
              />
            ) : null}
          </Card>
        )}

        <Input
          placeholder="Manual barcode entry"
          value={manual}
          onChangeText={setManual}
          autoCapitalize="characters"
        />
        <Button label="Lookup barcode" onPress={() => lookup(manual, 'manual')} loading={loading} />
        {SHOW_DEMO_TOOLS ? (
          <Button
            label="Simulate BATCH-002 barcode"
            variant="secondary"
            loading={loading}
            onPress={async () => {
              if (inFlight.current) return;
              setLoading(true);
              setError('');
              try {
                const inv = await inventoryApi.list({ q: 'BATCH-002' });
                const batch = inv.data.batches?.[0];
                if (batch?.barcode_value) {
                  setManual(batch.barcode_value);
                  await lookup(batch.barcode_value, 'simulated');
                } else {
                  setError('BATCH-002 not found in seed data');
                  setLoading(false);
                }
              } catch (e) {
                setError(getErrorMessage(e));
                setLoading(false);
              }
            }}
          />
        ) : null}

        {error ? <Text style={{ color: colors.danger, marginVertical: 8 }}>{error}</Text> : null}

        {result ? (
          <Card>
            <Badge label={result.type} />
            <Subtitle>
              {result.type === 'BATCH'
                ? result.batch?.batch_code
                : result.type === 'UNIT'
                  ? result.unit?.unit_code
                  : result.rack?.code}
            </Subtitle>
            <Muted>Source: {result.source}</Muted>
            {result.type === 'BATCH' ? (
              <>
                <Text>{result.batch?.item?.name}</Text>
                <Text>Available: {result.batch?.available_qty}</Text>
                <Text>Barcode: {result.barcode}</Text>
                {result.fifo && !result.fifo.eligible ? (
                  <FifoAlert message={result.fifo.message} older={result.fifo.older} />
                ) : (
                  <Muted>Ready — this is the oldest available stock</Muted>
                )}
                <Button
                  label="Withdraw"
                  onPress={() =>
                    navigation.navigate('Withdrawal', {
                      screen: 'WithdrawalMain',
                      params: { batchId: result.batch.id },
                    })
                  }
                />
              </>
            ) : null}
            {result.type === 'UNIT' ? (
              <>
                <Text>{result.unit?.item?.name}</Text>
                <Text>Status: {result.unit?.status}</Text>
                {result.fifo && !result.fifo.eligible ? (
                  <FifoAlert message={result.fifo.message} older={result.fifo.older} />
                ) : null}
                <Button
                  label="Withdraw unit"
                  onPress={() =>
                    navigation.navigate('Withdrawal', {
                      screen: 'WithdrawalMain',
                      params: { unitId: result.unit.id },
                    })
                  }
                />
              </>
            ) : null}
            {result.type === 'RACK' ? (
              <Button
                label="Open rack"
                onPress={() =>
                  navigation.navigate('Warehouse', {
                    screen: 'RackMap',
                    params: { id: result.rack.id },
                  })
                }
              />
            ) : null}
          </Card>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
