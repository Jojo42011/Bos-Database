import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import path from 'node:path';

const blocked = new BlockList();
for (const [ip, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['192.0.0.0', 24],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
])
  blocked.addSubnet(ip, prefix, 'ipv4');
for (const [ip, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
  ['2001:db8::', 32],
])
  blocked.addSubnet(ip, prefix, 'ipv6');
export function privateAddress(address) {
  const raw = address.replace(/^\[|\]$/g, '');
  if (raw.toLowerCase().startsWith('::ffff:')) return true;
  const version = isIP(raw);
  return !version || blocked.check(raw, version === 4 ? 'ipv4' : 'ipv6');
}
export function makePolicy({ allowedHosts = ['posh.vip'], testOrigin } = {}) {
  const cache = new Map();
  const parse = (value, navigation = true) => {
    let u;
    try {
      u = new URL(value);
    } catch {
      throw new Error('Use a valid HTTPS POSH URL.');
    }
    if (testOrigin && u.origin === testOrigin) return u;
    if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443'))
      throw new Error('Only HTTPS web pages on approved hosts are allowed.');
    if (navigation && !allowedHosts.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`)))
      throw new Error('This host is not approved for browser navigation.');
    if (isIP(u.hostname.replace(/^\[|\]$/g, '')))
      throw new Error('Direct IP addresses are not allowed.');
    return u;
  };
  return {
    parse,
    async check(value, navigation = true) {
      const u = parse(value, navigation);
      if (testOrigin && u.origin === testOrigin) return;
      const cached = cache.get(u.hostname);
      if (cached && cached > Date.now()) return;
      const addresses = await lookup(u.hostname, { all: true });
      if (!addresses.length || addresses.some((a) => privateAddress(a.address)))
        throw new Error('Private network destinations are blocked.');
      cache.set(u.hostname, Date.now() + 30000);
    },
  };
}

export class CredentialVault {
  constructor(dir, keyHex) {
    this.file = path.join(dir, 'credentials.enc');
    this.key = /^[a-f0-9]{64}$/i.test(keyHex || '') ? Buffer.from(keyHex, 'hex') : null;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  status() {
    return { available: !!this.key, saved: !!this.key && existsSync(this.file) };
  }
  save(value) {
    if (!this.key)
      throw new Error(
        'Set BROWSER_VAULT_KEY to 64 random hex characters before storing credentials.',
      );
    const iv = randomBytes(12),
      cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    const temp = `${this.file}.tmp`;
    writeFileSync(
      temp,
      JSON.stringify({
        iv: iv.toString('hex'),
        tag: cipher.getAuthTag().toString('hex'),
        data: encrypted.toString('hex'),
      }),
      { mode: 0o600 },
    );
    renameSync(temp, this.file);
  }
  read() {
    if (!this.status().saved)
      throw new Error('No saved credentials. Sign in using the browser panel.');
    try {
      const v = JSON.parse(readFileSync(this.file, 'utf8')),
        decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(v.iv, 'hex'));
      decipher.setAuthTag(Buffer.from(v.tag, 'hex'));
      return JSON.parse(
        Buffer.concat([decipher.update(Buffer.from(v.data, 'hex')), decipher.final()]).toString(
          'utf8',
        ),
      );
    } catch {
      throw new Error('Could not unlock saved credentials. Check the vault key.');
    }
  }
}
