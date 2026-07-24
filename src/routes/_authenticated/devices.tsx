import { createFileRoute } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { listMyDevices } from '@/lib/crypto.functions';
import {
  ensureRegisteredDevice,
  refreshPrekeys,
  revokeThisDeviceEverywhere,
  fetchAndVerifyPeerBundles,
} from '@/lib/crypto-client';
import { getCryptoProvider } from '@/lib/crypto/noble-provider';
import { toBase64, fromMaybeBytea } from '@/lib/crypto/encoding';
import { computeSafetyNumber } from '@/lib/crypto/safety-numbers';

export const Route = createFileRoute('/_authenticated/devices')({
  component: DevicesPage,
  head: () => ({
    meta: [
      { title: 'Devices & Keys — Whispr' },
      {
        name: 'description',
        content:
          'Manage your cryptographic identity and per-device keys. Verify safety numbers with people you talk to.',
      },
    ],
  }),
});

function DevicesPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listMyDevices);
  const devices = useQuery({ queryKey: ['devices'], queryFn: () => listFn() });
  const [thisDeviceId, setThisDeviceId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('');
  const [myFingerprint, setMyFingerprint] = useState<string[]>([]);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [peerInput, setPeerInput] = useState('');
  const [peerSafety, setPeerSafety] = useState<string[] | null>(null);
  const [peerErr, setPeerErr] = useState('');

  useEffect(() => {
    (async () => {
      setStatus('Provisioning device keys locally…');
      const { deviceId } = await ensureRegisteredDevice();
      setThisDeviceId(deviceId);
      const id = await getCryptoProvider().loadIdentity();
      if (id) {
        // Show self-fingerprint as if the peer were us (used only for display).
        const s = computeSafetyNumber(id.publicIdentityKey, id.publicIdentityKey);
        setMyFingerprint(s.displayGroups);
        const png = await QRCode.toDataURL(toBase64(id.publicIdentityKey), {
          margin: 1,
          color: { dark: '#ffffff', light: '#00000000' },
          width: 220,
        });
        setQrDataUrl(png);
      }
      setStatus('');
      qc.invalidateQueries({ queryKey: ['devices'] });
    })().catch((e) => setStatus('Setup failed: ' + (e as Error).message));
  }, [qc]);

  const rotateM = useMutation({
    mutationFn: async () => {
      if (!thisDeviceId) return;
      await refreshPrekeys(thisDeviceId, 25);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['devices'] }),
  });

  const revokeM = useMutation({
    mutationFn: async (deviceId: string) => revokeThisDeviceEverywhere(deviceId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['devices'] }),
  });

  async function verifyPeer() {
    setPeerErr('');
    setPeerSafety(null);
    try {
      const { bundles, identityChanged } = await fetchAndVerifyPeerBundles(peerInput.trim());
      if (bundles.length === 0) {
        setPeerErr('No active device keys published by that user.');
        return;
      }
      const id = await getCryptoProvider().loadIdentity();
      if (!id) throw new Error('no local identity');
      const s = computeSafetyNumber(id.publicIdentityKey, bundles[0]!.publicIdentityKey);
      setPeerSafety(s.displayGroups);
      if (identityChanged) {
        setPeerErr('⚠ Their identity key changed since you last verified. Re-verify in person.');
      }
    } catch (e) {
      setPeerErr((e as Error).message);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-14 text-white">
      <h1 className="font-instrument text-4xl mb-2">Devices &amp; keys</h1>
      <p className="text-white/60 mb-8">
        Private keys are generated and stored on this device only. They are
        never sent to Whispr, backups, logs, or analytics.
      </p>

      <span className="inline-flex items-center gap-2 rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs text-amber-200 mb-8">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
        E2EE implementation in progress — not independently audited
      </span>

      {status && <div className="text-sm text-white/70 mb-4">{status}</div>}

      <section className="glass-strong rounded-2xl p-6 mb-8">
        <div className="flex items-start gap-6">
          {qrDataUrl && (
            <img
              src={qrDataUrl}
              alt="Your identity key QR"
              className="w-40 h-40 rounded-lg border border-white/10 bg-black/40 p-2"
            />
          )}
          <div>
            <div className="text-xs uppercase tracking-widest text-white/50">
              Your identity fingerprint
            </div>
            <div className="mt-2 font-mono text-lg tracking-wider">
              {myFingerprint.join(' ')}
            </div>
            <p className="mt-3 text-sm text-white/60 max-w-md">
              Share this fingerprint (or scan the QR) with a contact and confirm
              theirs matches yours in the verification screen below.
            </p>
            <div className="mt-4 flex gap-3">
              <button
                onClick={() => rotateM.mutate()}
                disabled={rotateM.isPending}
                className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm hover:bg-white/10"
              >
                {rotateM.isPending ? 'Rotating…' : 'Rotate signed prekey + replenish'}
              </button>
              <button
                onClick={() => thisDeviceId && revokeM.mutate(thisDeviceId)}
                className="rounded-full border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-200 hover:bg-red-500/20"
              >
                Revoke &amp; wipe this device
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="glass-strong rounded-2xl p-6 mb-8">
        <h2 className="text-lg font-medium mb-3">Verify a contact</h2>
        <div className="flex gap-2">
          <input
            value={peerInput}
            onChange={(e) => setPeerInput(e.target.value)}
            placeholder="Contact user ID (UUID)"
            className="flex-1 rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm"
          />
          <button
            onClick={verifyPeer}
            className="rounded-lg bg-[hsl(var(--brand))] px-4 py-2 text-sm text-black"
          >
            Compute safety number
          </button>
        </div>
        {peerErr && <p className="mt-3 text-sm text-amber-300">{peerErr}</p>}
        {peerSafety && (
          <div className="mt-4">
            <div className="text-xs uppercase tracking-widest text-white/50">
              Compare these numbers out loud
            </div>
            <div className="mt-2 font-mono text-lg tracking-wider">
              {peerSafety.join(' ')}
            </div>
          </div>
        )}
      </section>

      <section>
        <h2 className="text-lg font-medium mb-3">All registered devices</h2>
        <ul className="space-y-3">
          {(devices.data ?? []).map((d) => {
            const pk = fromMaybeBytea(d.public_identity_key as unknown as string);
            const isThis = d.id === thisDeviceId;
            return (
              <li
                key={d.id}
                className={`rounded-xl border p-4 ${
                  d.revoked_at
                    ? 'border-white/5 bg-white/[0.02] opacity-60'
                    : 'border-white/10 bg-white/[0.04]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">
                      {d.name}{' '}
                      {isThis && (
                        <span className="ml-2 text-xs text-[hsl(var(--brand))]">
                          this device
                        </span>
                      )}
                      {d.revoked_at && (
                        <span className="ml-2 text-xs text-red-300">revoked</span>
                      )}
                    </div>
                    <div className="text-xs text-white/50">
                      {d.platform} · {d.key_algorithm ?? '—'} · crypto v
                      {d.crypto_version} · id {d.device_public_id ?? d.id.slice(0, 8)}
                    </div>
                    {pk && (
                      <div className="mt-1 font-mono text-[10px] text-white/40 break-all">
                        {toBase64(pk).slice(0, 44)}…
                      </div>
                    )}
                  </div>
                  {!isThis && !d.revoked_at && (
                    <button
                      onClick={() => revokeM.mutate(d.id)}
                      className="rounded-full border border-white/10 px-3 py-1 text-xs hover:bg-white/10"
                    >
                      Revoke
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
