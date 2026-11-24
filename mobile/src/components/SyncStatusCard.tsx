import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { useOfflineQueue } from '../context/OfflineQueueContext';
import { colors, fonts } from '../theme/tokens';
import { Badge, Button, Card, Muted, TextAction } from './ui';

/**
 * Shows changes saved on the phone while offline and lets the user sync or clear them.
 * Hidden when nothing is waiting, unless `alwaysShow` is set (Settings).
 */
export function SyncStatusCard({ alwaysShow = false }: { alwaysShow?: boolean }) {
  const { jobs, pending, failed, syncing, lastMessage, syncNow, retryFailed, discard } = useOfflineQueue();
  const [open, setOpen] = useState(false);

  if (!alwaysShow && jobs.length === 0) return null;

  const title =
    jobs.length === 0
      ? 'Everything is synced'
      : pending > 0
        ? `${pending} change${pending === 1 ? '' : 's'} waiting to sync`
        : `${failed} change${failed === 1 ? '' : 's'} need attention`;

  return (
    <Card style={{ backgroundColor: failed > 0 ? colors.dangerSoft : jobs.length ? colors.warningSoft : undefined }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <Text style={{ fontFamily: fonts.uiBold, color: colors.navy, flex: 1 }}>{title}</Text>
        {jobs.length > 0 ? (
          <Badge label={pending > 0 ? 'Offline queue' : 'Rejected'} tone={pending > 0 ? 'warning' : 'danger'} />
        ) : null}
      </View>
      {jobs.length > 0 ? (
        <Muted>Saved on this phone. They are sent in order as soon as the connection is back.</Muted>
      ) : (
        <Muted>Scans and moves made without Wi-Fi are saved here and sent automatically.</Muted>
      )}
      {lastMessage && jobs.length > 0 ? <Muted>{lastMessage}</Muted> : null}

      {jobs.length > 0 ? (
        <View style={{ marginTop: 8, gap: 8 }}>
          {pending > 0 ? <Button label="Sync now" onPress={() => void syncNow()} loading={syncing} /> : null}
          {failed > 0 ? (
            <Button label="Retry rejected" variant="secondary" onPress={() => void retryFailed()} loading={syncing} />
          ) : null}
          <TextAction label={open ? 'Hide details' : 'Show details'} onPress={() => setOpen((v) => !v)} tone="muted" />
        </View>
      ) : null}

      {open
        ? jobs.map((job) => (
            <View
              key={job.id}
              style={{ borderTopWidth: 1, borderTopColor: colors.borderSoft, paddingTop: 8, marginTop: 8 }}
            >
              <Text style={{ fontFamily: fonts.uiSemi, color: colors.navy }}>{job.label}</Text>
              <Muted>
                {new Date(job.createdAt).toLocaleString()} · {job.status === 'failed' ? 'rejected' : 'waiting'}
                {job.attempts ? ` · ${job.attempts} attempt${job.attempts === 1 ? '' : 's'}` : ''}
              </Muted>
              {job.error ? <Text style={{ color: colors.danger, marginTop: 2 }}>{job.error}</Text> : null}
              {job.status === 'failed' ? (
                <View style={{ marginTop: 4 }}>
                  <TextAction label="Discard" tone="danger" onPress={() => void discard(job.id)} />
                </View>
              ) : null}
            </View>
          ))
        : null}
    </Card>
  );
}
