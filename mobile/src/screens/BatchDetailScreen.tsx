import React, { useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { inventoryApi, barcodeApi } from '../api/endpoints';
import { getErrorMessage } from '../api/client';
import { CubeIcon } from '../components/icons';
import { Badge, Button, Card, ErrorState, LoadingState, Muted, Screen, Subtitle } from '../components/ui';
import { useTabScrollPadding } from '../hooks/useTabScrollPadding';
import { colors, radius } from '../theme/tokens';

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
  const scrollPad = useTabScrollPadding(28);
  const [batch, setBatch] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [labelUri, setLabelUri] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [printMsg, setPrintMsg] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState('');

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
    load();
  }, [id]);

  useEffect(() => {
    if (batch?.batch_code) navigation.setOptions({ title: batch.batch_code });
  }, [batch?.batch_code, navigation]);

  const pickAndUploadImage = async () => {
    if (!batch?.item?.id) return;
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
      setUploadMsg('Item photo updated');
    } catch (e) {
      setUploadMsg(getErrorMessage(e));
    } finally {
      setUploading(false);
    }
  };

  if (!id) return <ErrorState message="Missing batch id" />;
  if (loading) return <LoadingState />;
  if (error || !batch) return <ErrorState message={error || 'Not found'} onRetry={load} />;

  const alloc = (batch.allocations || []).find((a: any) => a.is_active && a.allocation_type === 'ACTUAL');
  const label = batch.barcode_label_data || {};
  const location = alloc
    ? `${alloc.warehouse} / ${alloc.rack} / ${alloc.shelf} / ${alloc.position_code}`
    : 'Unassigned';
  const itemImage = batch.item?.image_url;

  return (
    <Screen style={{ padding: 0 }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: scrollPad }}>
        <Card>
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
                  backgroundColor: colors.primarySoft,
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 12,
                  gap: 8,
                }}
              >
                <CubeIcon size={40} color={colors.primaryDark} />
                <Text style={{ fontWeight: '700', color: colors.primaryDark }}>Tap to add item photo</Text>
                <Muted>Shown on all batches for this item</Muted>
              </View>
            )}
          </Pressable>

          <Text style={{ fontSize: 22, fontWeight: '800', color: colors.navy }}>{batch.item?.name}</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, marginBottom: 4, flexWrap: 'wrap' }}>
            <Badge label={batch.testing_status} tone={batch.testing_status === 'PASSED' ? 'success' : 'warning'} />
            <Badge label={batch.item?.inventory_type || 'BULK'} tone="primary" />
          </View>
          <Muted>{batch.batch_code}</Muted>
          <Button
            label={itemImage ? 'Change item photo' : 'Upload item photo'}
            variant="secondary"
            loading={uploading}
            onPress={pickAndUploadImage}
          />
          {uploadMsg ? <Muted>{uploadMsg}</Muted> : null}
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
          <Button
            label="Log print"
            variant="secondary"
            onPress={async () => {
              if (!batch.barcode_value) return;
              await barcodeApi.printLog(batch.barcode_value, { notes: 'mobile label preview' });
              setPrintMsg('Print logged');
            }}
          />
          {printMsg ? <Muted>{printMsg}</Muted> : null}
        </Card>

        <Card>
          <Subtitle>History</Subtitle>
          {history.length === 0 ? <Muted>No transactions yet</Muted> : null}
          {history.map((tx) => (
            <DetailRow
              key={tx.id}
              label={tx.type}
              value={`${tx.quantity || ''} · ${String(tx.created_at).slice(0, 19)}`}
            />
          ))}
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
