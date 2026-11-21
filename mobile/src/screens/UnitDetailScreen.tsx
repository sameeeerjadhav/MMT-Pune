import React, { useEffect, useState } from 'react';
import { Image, ScrollView, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { inventoryApi } from '../api/endpoints';
import { getErrorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { CubeIcon } from '../components/icons';
import { Badge, Button, Card, ErrorState, LoadingState, Muted, Screen, Subtitle } from '../components/ui';
import { useTabScrollPadding } from '../hooks/useTabScrollPadding';
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
  const [history, setHistory] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState('');
  const [testingMsg, setTestingMsg] = useState('');
  const [testingSaving, setTestingSaving] = useState(false);

  const load = async () => {
    setError('');
    setLoading(true);
    try {
      const [u, h] = await Promise.all([inventoryApi.unit(id), inventoryApi.history('unit', id)]);
      setUnit(u.data);
      setHistory(h.data);
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
      setUploadMsg('Item photo updated');
    } catch (e) {
      setUploadMsg(getErrorMessage(e));
    } finally {
      setUploading(false);
    }
  };

  if (loading) return <LoadingState />;
  if (error || !unit) return <ErrorState message={error || 'Not found'} onRetry={load} />;

  const alloc = (unit.allocations || []).find((a: any) => a.is_active && a.allocation_type === 'ACTUAL');
  const location = alloc
    ? `${alloc.warehouse} / ${alloc.rack} / ${alloc.shelf} / ${alloc.position_code}`
    : 'Unassigned';
  const itemImage = unit.item?.image_url;

  return (
    <Screen style={{ padding: 0 }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: scrollPad }}>
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
                backgroundColor: colors.primarySoft,
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 12,
                gap: 8,
              }}
            >
              <CubeIcon size={36} color={colors.primaryDark} />
              <Muted>No item photo yet</Muted>
            </View>
          )}
          <Text style={{ fontSize: 22, fontWeight: '800', color: colors.navy }}>{unit.item?.name}</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, marginBottom: 4 }}>
            <Badge label={unit.status} tone={unit.status === 'AVAILABLE' ? 'success' : 'danger'} />
          </View>
          <Muted>{unit.unit_code}</Muted>
          {canManage ? (
            <>
              <Button
                label={itemImage ? 'Change item photo' : 'Upload item photo'}
                variant="secondary"
                loading={uploading}
                onPress={pickAndUploadImage}
              />
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
                  loading={testingSaving}
                  onPress={async () => {
                    setTestingSaving(true);
                    setTestingMsg('');
                    try {
                      const { data } = await inventoryApi.updateUnitTesting(unit.id, status);
                      setUnit(data);
                      setTestingMsg(`Testing set to ${status}`);
                    } catch (e) {
                      setTestingMsg(getErrorMessage(e));
                    } finally {
                      setTestingSaving(false);
                    }
                  }}
                />
              ))}
              {testingMsg ? <Muted>{testingMsg}</Muted> : null}
            </View>
          ) : null}
        </Card>

        <Card>
          <Subtitle>History</Subtitle>
          {history.length === 0 ? <Muted>No transactions yet</Muted> : null}
          {history.map((tx) => (
            <DetailRow key={tx.id} label={tx.type} value={String(tx.created_at).slice(0, 19)} />
          ))}
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
