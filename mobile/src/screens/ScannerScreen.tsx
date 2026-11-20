import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { inventoryApi } from '../api/endpoints';
import { getErrorMessage } from '../api/client';
import { Badge, Button, Card, FifoAlert, Input, Muted, Screen, Subtitle, Title } from '../components/ui';
import { colors } from '../theme/tokens';

export default function ScannerScreen({ navigation }: any) {
  const [permission, requestPermission] = useCameraPermissions();
  const [manual, setManual] = useState('');
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');
  const [scanning, setScanning] = useState(true);

  const lookup = async (code: string, source: string) => {
    if (!code) return;
    setError('');
    try {
      const { data } = await inventoryApi.scan(code.trim());
      setResult({ ...data, source });
      setScanning(false);
    } catch (e) {
      setError(getErrorMessage(e));
      setResult(null);
    }
  };

  return (
    <Screen>
      <Title>Scanner</Title>
      <Muted>Camera, manual entry, or simulated seed barcodes.</Muted>

      {permission?.granted && scanning ? (
        <View style={{ height: 240, borderRadius: 12, overflow: 'hidden', marginBottom: 12 }}>
          <CameraView
            style={{ flex: 1 }}
            barcodeScannerSettings={{ barcodeTypes: ['code128', 'qr', 'ean13'] }}
            onBarcodeScanned={({ data }) => lookup(data, 'camera')}
          />
        </View>
      ) : (
        <Card>
          <Muted>Camera {permission?.granted ? 'paused after scan' : 'permission needed'}</Muted>
          {!permission?.granted ? <Button label="Enable camera" onPress={requestPermission} /> : null}
          {!scanning ? <Button label="Scan again" variant="secondary" onPress={() => { setScanning(true); setResult(null); }} /> : null}
        </Card>
      )}

      <Input placeholder="Manual barcode entry" value={manual} onChangeText={setManual} autoCapitalize="characters" />
      <Button label="Lookup barcode" onPress={() => lookup(manual, 'manual')} />
      <Button
        label="Simulate BATCH-002 barcode"
        variant="secondary"
        onPress={async () => {
          const inv = await inventoryApi.list({ q: 'BATCH-002' });
          const batch = inv.data.batches?.[0];
          if (batch?.barcode_value) {
            setManual(batch.barcode_value);
            lookup(batch.barcode_value, 'simulated');
          } else {
            setError('BATCH-002 not found in seed data');
          }
        }}
      />

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
          {result.type === 'BATCH' ? (
            <>
              <Text>{result.batch?.item?.name}</Text>
              <Text>Available: {result.batch?.available_qty}</Text>
              <Text>Barcode: {result.barcode}</Text>
              {result.fifo && !result.fifo.eligible ? (
                <FifoAlert message={result.fifo.message} older={result.fifo.older} />
              ) : (
                <Muted>FIFO eligible</Muted>
              )}
              <Button
                label="Withdraw"
                onPress={() => navigation.navigate('Withdrawal', { batchId: result.batch.id })}
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
                onPress={() => navigation.navigate('Withdrawal', { unitId: result.unit.id })}
              />
            </>
          ) : null}
          {result.type === 'RACK' ? (
            <Button label="Open rack" onPress={() => navigation.navigate('RackDetail', { id: result.rack.id })} />
          ) : null}
        </Card>
      ) : null}
    </Screen>
  );
}
