import React, { useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { inventoryApi, barcodeApi } from '../api/endpoints';
import { getErrorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { StockLogo } from '../components/icons';
import { Badge, Button, Card, ErrorState, Input, Muted, Screen, Subtitle } from '../components/ui';
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

export default function BatchDetailScreen({ route, navigation }: any) {
  const id = route?.params?.id;
  const { user } = useAuth();
  const canManage = canAccess(user?.role, 'manageMasterData');
  const scrollPad = useTabScrollPadding(28);
  const [batch, setBatch] = useState<any>(null);
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
  const [expiryInput, setExpiryInput] = useState('');
  const [expiryMsg, setExpiryMsg] = useState('');
  const [expirySaving, setExpirySaving] = useState(false);
  const [testingSavingStatus, setTestingSavingStatus] = useState<string | null>(null);

  const load = async () => {
    try {
      const [b, h] = await Promise.all([inventoryApi.batch(id), inventoryApi.history('batch', id)]);
      setBatch(b.data);
      setHistory(h.data);
      if (b.data.barcode_value) {
        // Label PNG URL requires JWT; <Image> cannot send Authorization — use base64 only.
        try {
          const detail = await barcodeApi.get(b.data.barcode_value);
          if (detail.data.label_image_base64) {
            setLabelUri(`data:image/png;base64,${detail.data.label_image_base64}`);
          } else {
            setLabelUri(null);
          }
        } catch {
          setLabelUri(null);
        }
      }
      setError('');
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (id) load();
  }, [id]);

  useEffect(() => {
    if (batch?.batch_code) navigation.setOptions({ title: batch.batch_code });
  }, [batch?.batch_code, navigation]);

  useEffect(() => {
    setExpiryInput(batch?.expiry_date || '');
  }, [batch?.expiry_date]);

  const saveExpiry = async (value: string | null) => {
    if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      setExpiryMsg('Use the format YYYY-MM-DD, for example 2027-03-31');
      return;
    }
    setExpirySaving(true);
    setExpiryMsg('');
    try {
      const { data } = await inventoryApi.updateBatchExpiry(batch.id, value);
      setBatch(data);
      setExpiryMsg(value ? `Expiry set to ${value}` : 'Expiry date cleared');
    } catch (e) {
      setExpiryMsg(getErrorMessage(e));
    } finally {
      setExpirySaving(false);
    }
  };

  const pickAndUploadImage = async () => {
    if (!canManage || !batch?.item?.id) return;
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
    const name = asset.fileName || `item-${batch.item.id}.jpg`;
    const type = asset.mimeType || 'image/jpeg';
    setUploading(true);
    try {
      const { data } = await inventoryApi.uploadItemImage(batch.item.id, {
        uri: asset.uri,
        name,
        type,
      });
      setBatch((prev: any) =>
        prev
          ? {
              ...prev,
              item: {
                ...prev.item,
                image: data.image,
                image_url: data.image_url,
              },
            }
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
    if (!canManage || !batch?.item?.id) return;
    setUploadMsg('');
    setRemoving(true);
    try {
      await inventoryApi.deleteItemImage(batch.item.id);
      setBatch((prev: any) =>
        prev
          ? {
              ...prev,
              item: {
                ...prev.item,
                image: null,
                image_url: null,
              },
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

  if (!id) return <ErrorState message="Missing batch id" />;
  if (loading) return <DetailSkeleton />;
  if (error || !batch) return <ErrorState message={error || 'Not found'} onRetry={load} />;

  const alloc = (batch.allocations || []).find((a: any) => a.is_active && a.allocation_type === 'ACTUAL');
  const label = batch.barcode_label_data || {};
  const location = alloc
    ? `${alloc.warehouse} / ${alloc.rack} / ${alloc.shelf} / ${alloc.position_code}`
    : 'Unassigned';
  const rawImage = batch.item?.image_url as string | undefined;
  const itemImage = rawImage
    ? `${rawImage}${rawImage.includes('?') ? '&' : '?'}t=${imageBust || batch.item?.updated_at || batch.updated_at || 0}`
    : null;

  return (
    <Screen style={{ padding: 0 }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: scrollPad }}>
        <Card>
          {canManage ? (
            <Pressable onPress={pickAndUploadImage} disabled={uploading}>
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
                    height: 180,
                    borderRadius: radius.md,
                    backgroundColor: colors.surfaceMuted,
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: 12,
                    gap: 8,
                  }}
                >
                  <StockLogo size={120} />
                  <Text style={{ fontWeight: '700', color: colors.primaryDark }}>Tap to add item photo</Text>
                  <Muted>Shown on all batches for this item</Muted>
                </View>
              )}
            </Pressable>
          ) : itemImage ? (
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

          <Text style={{ fontSize: 22, fontWeight: '800', color: colors.navy }}>{batch.item?.name}</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, marginBottom: 4, flexWrap: 'wrap' }}>
            <Badge label={batch.testing_status} tone={batch.testing_status === 'PASSED' ? 'success' : 'warning'} />
            <Badge label={batch.item?.inventory_type || 'BULK'} tone="primary" />
          </View>
          <Muted>{batch.batch_code}</Muted>
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
          <Subtitle>Item details</Subtitle>
          <DetailRow label="Item code" value={batch.item?.item_code} />
          <DetailRow label="Category" value={batch.item?.category_name} />
          <DetailRow label="UOM" value={batch.item?.uom} />
          <DetailRow label="Description" value={batch.item?.description || '—'} />
        </Card>

        <Card>
          <Subtitle>Batch stock</Subtitle>
          <DetailRow label="Batch code" value={batch.batch_code} />
          <DetailRow label="Batch ID" value={batch.id} />
          <DetailRow label="GRN" value={batch.grn_number} />
          <DetailRow label="Received" value={String(batch.received_at).slice(0, 10)} />
          <DetailRow label="Available qty" value={batch.available_qty} />
          <DetailRow label="Received qty" value={batch.received_qty} />
          <DetailRow label="Withdrawn qty" value={batch.withdrawn_qty} />
          <DetailRow label="Reserved qty" value={batch.reserved_qty} />
          <DetailRow label="Barcode" value={batch.barcode_value} />
          <DetailRow label="Location" value={location} />
          <DetailRow label="Testing" value={batch.testing_status} />
          <DetailRow label="Expiry date" value={batch.expiry_date || 'Not set'} />
          {canManage ? (
            <View style={{ marginTop: 8 }}>
              <Input
                label="Expiry date (YYYY-MM-DD)"
                value={expiryInput}
                onChangeText={setExpiryInput}
                placeholder="e.g. 2027-03-31"
                keyboardType="numbers-and-punctuation"
                autoCorrect={false}
              />
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Button
                    label="Save expiry"
                    variant="secondary"
                    loading={expirySaving}
                    onPress={() => saveExpiry(expiryInput.trim() || null)}
                  />
                </View>
                {batch.expiry_date ? (
                  <View style={{ flex: 1 }}>
                    <Button label="Clear" variant="ghost" disabled={expirySaving} onPress={() => saveExpiry(null)} />
                  </View>
                ) : null}
              </View>
              {expiryMsg ? <Muted>{expiryMsg}</Muted> : null}
            </View>
          ) : null}
          {canManage ? (
            <View style={{ marginTop: 8, gap: 6 }}>
              <Muted>Set testing status (leads only)</Muted>
              {(['PENDING', 'PASSED', 'FAILED'] as const).map((status) => (
                <Button
                  key={status}
                  label={status}
                  variant={batch.testing_status === status ? 'primary' : 'secondary'}
                  loading={testingSavingStatus === status}
                  onPress={async () => {
                    if (testingSavingStatus) return;
                    setTestingSavingStatus(status);
                    setTestingMsg('');
                    try {
                      const { data } = await inventoryApi.updateBatchTesting(batch.id, status);
                      setBatch(data);
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
          <DetailRow label="Company" value={label.company_name || 'Airport Equipment Manufacturing'} />
          <DetailRow label="Item" value={label.item_name || batch.item?.name} />
          <DetailRow label="Code" value={label.item_code || batch.item?.item_code} />
          <DetailRow label="GRN" value={label.grn_number || batch.grn_number} />
          <DetailRow label="Batch" value={label.batch_or_unit || batch.batch_code} />
          {label.quantity ? <DetailRow label="Qty" value={label.quantity} /> : null}
          {labelUri ? (
            <Image
              source={{ uri: labelUri }}
              style={{ width: '100%', height: 160, resizeMode: 'contain', marginTop: 8, backgroundColor: '#fff' }}
            />
          ) : (
            <Muted>Label image unavailable</Muted>
          )}
          {batch.barcode_value ? <PrintLabelPanel barcodeValue={batch.barcode_value} /> : null}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Button
                label="Log print"
                variant="secondary"
                onPress={async () => {
                  if (!batch.barcode_value) return;
                  try {
                    await barcodeApi.printLog(batch.barcode_value, { notes: 'mobile label preview' });
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
                  if (!batch.barcode_value) return;
                  setPdfLoading(true);
                  setPrintMsg('');
                  try {
                    const result = await downloadOrBuildBarcodePdf({
                      barcodeValue: batch.barcode_value,
                      labelPngDataUrl: labelUri,
                      filename: `${batch.barcode_value}-label.pdf`,
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
            const bits = [tx.quantity != null && tx.quantity !== '' ? `Qty ${tx.quantity}` : '', loc, tx.user_name]
              .filter(Boolean)
              .join(' · ');
            return (
              <View key={tx.id} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.borderSoft }}>
                <Text style={{ fontWeight: '700', color: colors.navy }}>{title}</Text>
                {bits ? <Muted>{bits}</Muted> : null}
                <Muted>{String(tx.created_at || '').slice(0, 19).replace('T', ' ')}</Muted>
              </View>
            );
          })}
        </Card>

        {Number(batch.available_qty) > 0 ? (
          <Button
            label="Withdraw this batch"
            onPress={() =>
              navigation.navigate('Withdrawal', {
                screen: 'WithdrawalMain',
                params: { batchId: batch.id },
              })
            }
          />
        ) : (
          <Card>
            <Subtitle>Already withdrawn</Subtitle>
            <Muted>
              Available quantity is 0. This batch cannot be withdrawn again (withdrawn {batch.withdrawn_qty}).
            </Muted>
          </Card>
        )}
      </ScrollView>
    </Screen>
  );
}
