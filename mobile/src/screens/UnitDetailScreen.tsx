import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, ScrollView, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { inventoryApi, barcodeApi } from '../api/endpoints';
import { getErrorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { StockLogo } from '../components/icons';
import { Badge, Button, Card, ErrorState, Muted, Screen, Subtitle } from '../components/ui';
import { DetailSkeleton } from '../components/Skeleton';
import { useTabScrollPadding } from '../hooks/useTabScrollPadding';
import { downloadOrBuildBarcodePdf } from '../utils/barcodePdf';
import { PrintLabelPanel } from '../components/PrintLabelPanel';
import { colors, radius } from '../theme/tokens';
import { canAccess } from '../utils/roles';

function DetailRow({ label, value }: { label: string; value?: string | number | null }) {
  if (value === undefined || value === null || value === '') return null;
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: 12,
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: colors.borderSoft,
      }}
    >
      <Text style={{ color: colors.muted, fontWeight: '600', fontSize: 13, flex: 1 }}>{label}</Text>
      <Text style={{ color: colors.navy, fontWeight: '700', fontSize: 14, flex: 1.4, textAlign: 'right' }}>
        {String(value)}
      </Text>
    </View>
  );
}

export default function UnitDetailScreen({ route, navigation }: any) {
  const id = route?.params?.id;
  const { user } = useAuth();
  const canManage = canAccess(user?.role, 'manageMasterData');
  const scrollPad = useTabScrollPadding(28);
  const [unit, setUnit] = useState<any>(null);
  const unitRef = useRef<any>(null);
  unitRef.current = unit;
  const [history, setHistory] = useState<any[]>([]);
  const [labelUri, setLabelUri] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [printMsg, setPrintMsg] = useState('');
  const [pdfLoading, setPdfLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState('');
  const [imageBust, setImageBust] = useState(0);
  const [removing, setRemoving] = useState(false);
  const [testingMsg, setTestingMsg] = useState('');
  const [testingSavingStatus, setTestingSavingStatus] = useState<string | null>(null);

  const load = async (silent = false) => {
    if (!silent) {
      setError('');
      setLoading(true);
    }
    try {
      const [u, h] = await Promise.all([inventoryApi.unit(id), inventoryApi.history('unit', id)]);
      setUnit(u.data);
      setHistory(h.data);
      if (u.data.barcode_value) {
        try {
          const detail = await barcodeApi.get(u.data.barcode_value);
          setLabelUri(
            detail.data.label_image_base64
              ? `data:image/png;base64,${detail.data.label_image_base64}`
              : null
          );
        } catch {
          setLabelUri(null);
        }
      } else {
        setLabelUri(null);
      }
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  // Reload on focus so status is fresh after a withdrawal / transfer from this screen.
  useFocusEffect(
    useCallback(() => {
      if (id) void load(unitRef.current != null);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id])
  );

  useEffect(() => {
    if (unit?.unit_code) navigation.setOptions({ title: unit.unit_code });
  }, [unit?.unit_code, navigation]);

  if (!id) return <ErrorState message="Missing unit id" />;

  const pickAndUploadImage = async () => {
    if (!canManage || !unit?.item?.id) return;
    setUploadMsg('');
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setUploadMsg('Photo library permission is required');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85,
      allowsEditing: true,
      aspect: [4, 3],
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    setUploading(true);
    try {
      const { data } = await inventoryApi.uploadItemImage(unit.item.id, {
        uri: asset.uri,
        name: asset.fileName || `item-${unit.item.id}.jpg`,
        type: asset.mimeType || 'image/jpeg',
      });
      setUnit((prev: any) =>
        prev
          ? { ...prev, item: { ...prev.item, image: data.image, image_url: data.image_url } }
          : prev
      );
      setImageBust(Date.now());
      setUploadMsg('Item photo updated');
    } catch (e) {
      setUploadMsg(getErrorMessage(e));
    } finally {
      setUploading(false);
    }
  };

  const removeItemImage = async () => {
    if (!canManage || !unit?.item?.id) return;
    setUploadMsg('');
    setRemoving(true);
    try {
      await inventoryApi.deleteItemImage(unit.item.id);
      setUnit((prev: any) =>
        prev
          ? {
              ...prev,
              item: { ...prev.item, image: null, image_url: null },
            }
          : prev
      );
      setImageBust(Date.now());
      setUploadMsg('Item photo removed');
    } catch (e) {
      setUploadMsg(getErrorMessage(e));
    } finally {
      setRemoving(false);
    }
  };

  if (loading) return <DetailSkeleton />;
  if (error || !unit) return <ErrorState message={error || 'Not found'} onRetry={() => load()} />;

  const alloc = (unit.allocations || []).find((a: any) => a.is_active && a.allocation_type === 'ACTUAL');
  const location = alloc
    ? `${alloc.warehouse} / ${alloc.rack} / ${alloc.shelf} / ${alloc.position_code}`
    : 'Unassigned';
  const rawImage = unit.item?.image_url as string | undefined;
  const itemImage = rawImage
    ? `${rawImage}${rawImage.includes('?') ? '&' : '?'}t=${imageBust || unit.item?.updated_at || unit.updated_at || 0}`
    : null;

  return (
    <Screen style={{ padding: 0 }}>
      <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} contentContainerStyle={{ padding: 16, paddingBottom: scrollPad }}>
        <Card>
          {itemImage ? (
            <Image
              source={{ uri: itemImage }}
              style={{
                width: '100%',
                height: 200,
                borderRadius: radius.md,
                backgroundColor: colors.surfaceMuted,
                marginBottom: 12,
              }}
              resizeMode="cover"
            />
          ) : (
            <View
              style={{
                height: 160,
                borderRadius: radius.md,
                backgroundColor: colors.surfaceMuted,
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 12,
              }}
            >
              <StockLogo size={110} />
            </View>
          )}
          <Text style={{ fontSize: 22, fontWeight: '800', color: colors.navy }}>{unit.item?.name}</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, marginBottom: 4 }}>
            <Badge label={unit.status} tone={unit.status === 'AVAILABLE' ? 'success' : 'danger'} />
          </View>
          <Muted>{unit.unit_code}</Muted>
          {canManage ? (
            <>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                <View style={{ flex: 1 }}>
                  <Button
                    label={itemImage ? 'Change item photo' : 'Upload item photo'}
                    variant="secondary"
                    loading={uploading}
                    onPress={pickAndUploadImage}
                  />
                </View>
                {itemImage ? (
                  <View style={{ flex: 1 }}>
                    <Button
                      label="Remove photo"
                      variant="ghost"
                      loading={removing}
                      onPress={removeItemImage}
                    />
                  </View>
                ) : null}
              </View>
              {uploadMsg ? <Muted>{uploadMsg}</Muted> : null}
            </>
          ) : null}
        </Card>

        <Card>
          <Subtitle>Unit details</Subtitle>
          <DetailRow label="Item code" value={unit.item?.item_code} />
          <DetailRow label="Barcode" value={unit.barcode_value} />
          <DetailRow label="GRN" value={unit.grn_number} />
          <DetailRow label="Testing" value={unit.testing_status} />
          <DetailRow label="Location" value={location} />
          {canManage ? (
            <View style={{ marginTop: 8, gap: 6 }}>
              <Muted>Set testing status (leads only)</Muted>
              {(['PENDING', 'PASSED', 'FAILED'] as const).map((status) => (
                <Button
                  key={status}
                  label={status}
                  variant={unit.testing_status === status ? 'primary' : 'secondary'}
                  loading={testingSavingStatus === status}
                  onPress={async () => {
                    if (testingSavingStatus) return;
                    setTestingSavingStatus(status);
                    setTestingMsg('');
                    try {
                      const { data } = await inventoryApi.updateUnitTesting(unit.id, status);
                      setUnit(data);
                      setTestingMsg(`Testing set to ${status}`);
                    } catch (e) {
                      setTestingMsg(getErrorMessage(e));
                    } finally {
                      setTestingSavingStatus(null);
                    }
                  }}
                />
              ))}
              {testingMsg ? <Muted>{testingMsg}</Muted> : null}
            </View>
          ) : null}
        </Card>

        <Card>
          <Subtitle>Label preview (Code 128)</Subtitle>
          {labelUri ? (
            <Image
              source={{ uri: labelUri }}
              style={{ width: '100%', height: 160, resizeMode: 'contain', marginTop: 8, backgroundColor: '#fff' }}
            />
          ) : (
            <Muted>{unit.barcode_value ? 'Label image unavailable' : 'No barcode on this unit'}</Muted>
          )}
          {unit.barcode_value ? <PrintLabelPanel barcodeValue={unit.barcode_value} /> : null}
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
            <View style={{ flex: 1 }}>
              <Button
                label="Log print"
                variant="secondary"
                onPress={async () => {
                  if (!unit.barcode_value) return;
                  try {
                    await barcodeApi.printLog(unit.barcode_value, { notes: 'mobile label preview' });
                    setPrintMsg('Print logged');
                  } catch (e) {
                    setPrintMsg(getErrorMessage(e));
                  }
                }}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                label="PDF"
                variant="secondary"
                loading={pdfLoading}
                onPress={async () => {
                  if (!unit.barcode_value) return;
                  setPdfLoading(true);
                  setPrintMsg('');
                  try {
                    const result = await downloadOrBuildBarcodePdf({
                      barcodeValue: unit.barcode_value,
                      labelPngDataUrl: labelUri,
                      filename: `${unit.barcode_value}-label.pdf`,
                    });
                    setPrintMsg(
                      result === 'printed'
                        ? 'Use Save as PDF in the print dialog'
                        : 'Share sheet opened — save or share the PDF'
                    );
                  } catch (e) {
                    setPrintMsg(getErrorMessage(e));
                  } finally {
                    setPdfLoading(false);
                  }
                }}
              />
            </View>
          </View>
          {printMsg ? <Muted>{printMsg}</Muted> : null}
        </Card>

        <Card>
          <Subtitle>History</Subtitle>
          {history.length === 0 ? <Muted>No transactions yet</Muted> : null}
          {history.map((tx) => {
            const title = tx.display_type || tx.type;
            const loc =
              tx.from_location && tx.to_location
                ? `${tx.from_location} → ${tx.to_location}`
                : tx.to_location || tx.from_location || '';
            const bits = [loc, tx.user_name].filter(Boolean).join(' · ');
            return (
              <View key={tx.id} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.borderSoft }}>
                <Text style={{ fontWeight: '700', color: colors.navy }}>{title}</Text>
                {bits ? <Muted>{bits}</Muted> : null}
                <Muted>{String(tx.created_at || '').slice(0, 19).replace('T', ' ')}</Muted>
              </View>
            );
          })}
        </Card>

        {unit.status === 'AVAILABLE' ? (
          <Button
            label="Withdraw this unit"
            onPress={() =>
              navigation.navigate('Withdrawal', {
                screen: 'WithdrawalMain',
                params: { unitId: unit.id },
              })
            }
          />
        ) : (
          <Card>
            <Subtitle>Already withdrawn</Subtitle>
            <Muted>Status is {unit.status}. This unit cannot be withdrawn again.</Muted>
          </Card>
        )}
      </ScrollView>
    </Screen>
  );
}
