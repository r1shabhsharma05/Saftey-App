// 🔐 Evidence Vault — SafeLife 2.0 Day 27 (plan §6 D27, §3 F5).
//
// Shows the server-verified hash chain for this alert's recorded
// evidence: per-chunk SHA-256 + chain hash, the vault root hash, and
// whether every chunk's bytes still match what was uploaded. Export
// shares the full integrity proof as JSON — everything a third party
// needs to re-verify independently (re-download each chunk by path,
// re-hash, re-chain, compare rootHash).
//
// The section only renders while an alert is live (mounted by
// AlertActiveView). A null vault means "could not reach the vault",
// shown as unavailable — never as verified.
import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, Share } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Theme } from '../constants/theme';
import Card from './ui/Card';
import AppleButton from './ui/AppleButton';
import SectionHeader from './ui/SectionHeader';
import { getBackendUrl } from '../utils/backendUrl';
import { getAuthHeaders } from '../utils/apiAuth';
import {
  fetchVault,
  fetchVaultProof,
  shortHash,
  type Vault,
} from '../utils/evidenceVault';

const formatKb = (bytes: number): string =>
  bytes >= 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${bytes} B`;

export default function EvidenceVault({ alertId }: { alertId: string }) {
  const [vault, setVault] = useState<Vault | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setUnavailable(false);
    try {
      const result = await fetchVault(getBackendUrl(), alertId, await getAuthHeaders());
      if (!result) {
        setUnavailable(true);
        setVault(null);
      } else {
        setVault(result);
      }
    } catch {
      setUnavailable(true);
      setVault(null);
    } finally {
      setLoading(false);
    }
  }, [alertId]);

  useEffect(() => {
    void load();
  }, [load]);

  const onExport = useCallback(async () => {
    setExporting(true);
    try {
      const proof = await fetchVaultProof(getBackendUrl(), alertId, await getAuthHeaders());
      if (!proof) return;
      await Share.share({
        message: JSON.stringify(proof, null, 2),
        title: `SafeLife evidence proof — ${alertId}`,
      });
    } finally {
      setExporting(false);
    }
  }, [alertId]);

  return (
    <View style={styles.section}>
      <SectionHeader
        icon={<Ionicons name="lock-closed-outline" size={18} color={Theme.colors.primary} />}
        title="Evidence Vault"
      />
      <Card style={styles.card}>
        {loading && <Text style={styles.hint}>Verifying evidence…</Text>}
        {!loading && unavailable && (
          <>
            <Text style={styles.hint}>Vault unavailable — check connection and retry.</Text>
            <AppleButton title="Retry" variant="tinted" onPress={() => void load()} />
          </>
        )}
        {!loading && !unavailable && vault && vault.chunks.length === 0 && (
          <Text style={styles.hint}>No evidence recorded yet — chunks appear here as they upload.</Text>
        )}
        {!loading && !unavailable && vault && vault.chunks.length > 0 && (
          <>
            <Text style={vault.verified ? styles.verified : styles.notVerified}>
              {vault.verified
                ? `✓ Verified — ${vault.chunks.length} chunk${vault.chunks.length === 1 ? '' : 's'} intact`
                : `⚠ Not verified — ${vault.missing.length} chunk${vault.missing.length === 1 ? '' : 's'} missing from storage`}
            </Text>
            <Text style={styles.root}>Root: {shortHash(vault.rootHash)}</Text>
            {vault.chunks.map((chunk) => (
              <View key={`${chunk.kind}-${chunk.index}`} style={styles.row}>
                <Text style={styles.rowText}>
                  {chunk.kind === 'audio' ? 'AUDIO' : 'VIDEO'} #{chunk.index} · {formatKb(chunk.bytes)} ·{' '}
                  {shortHash(chunk.sha256)}
                </Text>
                <Text style={chunk.verified ? styles.tick : styles.cross}>{chunk.verified ? '✓' : '✗'}</Text>
              </View>
            ))}
            <View style={styles.actions}>
              <AppleButton
                title={exporting ? 'Preparing…' : 'Export integrity proof'}
                variant="tinted"
                onPress={() => void onExport()}
              />
              <AppleButton title="Refresh" variant="plain" onPress={() => void load()} />
            </View>
          </>
        )}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: 16,
  },
  card: {
    padding: 16,
  },
  hint: {
    fontSize: 14,
    color: Theme.colors.onSurfaceVariant,
    lineHeight: 20,
  },
  verified: {
    fontSize: 15,
    fontWeight: '700',
    color: Theme.colors.successText,
    marginBottom: 4,
  },
  notVerified: {
    fontSize: 15,
    fontWeight: '700',
    color: Theme.colors.errorText,
    marginBottom: 4,
  },
  root: {
    fontSize: 13,
    color: Theme.colors.onSurfaceVariant,
    marginBottom: 10,
    fontFamily: 'monospace',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  rowText: {
    fontSize: 13,
    color: Theme.colors.onSurface,
    fontFamily: 'monospace',
  },
  tick: {
    fontSize: 14,
    fontWeight: '700',
    color: Theme.colors.successText,
  },
  cross: {
    fontSize: 14,
    fontWeight: '700',
    color: Theme.colors.errorText,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
});
