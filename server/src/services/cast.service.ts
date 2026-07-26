import dgram from 'node:dgram';
import crypto from 'node:crypto';
import os from 'node:os';
import net from 'node:net';
import { config } from '../config.js';
import type { CastDevice } from '../types/api.js';

const SSDP_ADDRESS = '239.255.255.250';
const SSDP_PORT = 1900;
const MEDIA_RENDERER_ST = 'urn:schemas-upnp-org:device:MediaRenderer:1';
const SSDP_ALL_ST = 'ssdp:all';
const AV_TRANSPORT_SERVICE = 'urn:schemas-upnp-org:service:AVTransport:1';
const RENDERING_CONTROL_SERVICE = 'urn:schemas-upnp-org:service:RenderingControl:1';
const DISCOVERY_TIMEOUT_MS = 3500;
const FETCH_TIMEOUT_MS = 5000;
const DEVICE_TTL_MS = 5 * 60 * 1000;

interface ServiceDescriptor {
  serviceType: string;
  controlURL: string;
}

interface ParsedDeviceDescription {
  udn: string | null;
  friendlyName: string | null;
  manufacturer: string | null;
  modelName: string | null;
  services: ServiceDescriptor[];
}

interface InternalCastDevice extends CastDevice {
  avTransportControlUrl: string;
  renderingControlUrl: string | null;
  expiresAt: number;
}

export interface CastDiscoveryCandidate {
  address: string;
  location: string;
  st: string | null;
  usn: string | null;
  server: string | null;
  name: string | null;
  manufacturer: string | null;
  modelName: string | null;
  hasAvTransport: boolean;
  accepted: boolean;
  reason: string | null;
}

const devices = new Map<string, InternalCastDevice>();

export async function discoverCastDevices(): Promise<CastDevice[]> {
  const responses = await ssdpSearch();
  await Promise.all(responses.map(response => addDeviceFromSsdp(response).catch(() => undefined)));
  pruneDevices();
  return publicDevices();
}

export async function inspectCastDiscovery(): Promise<CastDiscoveryCandidate[]> {
  const responses = await ssdpSearch();
  const candidates = await Promise.all(responses.map(async response => {
    const location = response.headers.location ?? '';
    const base = {
      address: response.address,
      location,
      st: response.headers.st ?? null,
      usn: response.headers.usn ?? null,
      server: response.headers.server ?? null,
      name: null,
      manufacturer: null,
      modelName: null,
      hasAvTransport: false,
      accepted: false,
      reason: null,
    } satisfies CastDiscoveryCandidate;

    const acceptable = getDeviceLocationRejectionReason(location, response.address);
    if (acceptable) return { ...base, reason: acceptable };

    try {
      const parsed = parseDeviceDescription(await fetchText(location));
      const hasAvTransport = parsed.services.some(service => service.serviceType === AV_TRANSPORT_SERVICE);
      return {
        ...base,
        name: parsed.friendlyName,
        manufacturer: parsed.manufacturer,
        modelName: parsed.modelName,
        hasAvTransport,
        accepted: hasAvTransport,
        reason: hasAvTransport ? null : 'Device description does not advertise AVTransport MediaRenderer control',
      };
    } catch (err) {
      return { ...base, reason: (err as Error).message };
    }
  }));
  return candidates.sort((a, b) => (a.name ?? a.location).localeCompare(b.name ?? b.location));
}

export function listCachedCastDevices(): CastDevice[] {
  pruneDevices();
  return publicDevices();
}

export function getCachedCastDevice(id: string): InternalCastDevice | null {
  pruneDevices();
  return devices.get(id) ?? null;
}

export function buildCastStreamUrl(videoId: number, targetHost: string): string {
  if (config.castPublicBaseUrl) {
    return new URL(`/api/videos/${videoId}/stream`, ensureTrailingSlash(config.castPublicBaseUrl)).toString();
  }
  const serverAddress = pickLanAddressForTarget(targetHost);
  return `http://${serverAddress}:${config.port}/api/videos/${videoId}/stream`;
}

export async function playOnDevice(device: InternalCastDevice, input: { streamUrl: string; title: string; site?: string | null }): Promise<void> {
  const metadata = buildDidlLiteMetadata(input.streamUrl, input.title, input.site);
  await soapAction(device.avTransportControlUrl, AV_TRANSPORT_SERVICE, 'SetAVTransportURI', {
    InstanceID: '0',
    CurrentURI: input.streamUrl,
    CurrentURIMetaData: metadata,
  });
  await soapAction(device.avTransportControlUrl, AV_TRANSPORT_SERVICE, 'Play', {
    InstanceID: '0',
    Speed: '1',
  });
}

export async function pauseDevice(device: InternalCastDevice): Promise<void> {
  await soapAction(device.avTransportControlUrl, AV_TRANSPORT_SERVICE, 'Pause', { InstanceID: '0' });
}

export async function resumeDevice(device: InternalCastDevice): Promise<void> {
  await soapAction(device.avTransportControlUrl, AV_TRANSPORT_SERVICE, 'Play', { InstanceID: '0', Speed: '1' });
}

export async function stopDevice(device: InternalCastDevice): Promise<void> {
  await soapAction(device.avTransportControlUrl, AV_TRANSPORT_SERVICE, 'Stop', { InstanceID: '0' });
}

export async function seekDevice(device: InternalCastDevice, seconds: number): Promise<void> {
  await soapAction(device.avTransportControlUrl, AV_TRANSPORT_SERVICE, 'Seek', {
    InstanceID: '0',
    Unit: 'REL_TIME',
    Target: formatDuration(seconds),
  });
}

export async function setDeviceVolume(device: InternalCastDevice, volume: number): Promise<void> {
  if (!device.renderingControlUrl) throw new Error('This device did not advertise volume control');
  await soapAction(device.renderingControlUrl, RENDERING_CONTROL_SERVICE, 'SetVolume', {
    InstanceID: '0',
    Channel: 'Master',
    DesiredVolume: String(Math.max(0, Math.min(100, Math.round(volume)))),
  });
}

export function parseDeviceDescription(xml: string): ParsedDeviceDescription {
  const services = extractAll(xml, /<service\b[^>]*>([\s\S]*?)<\/service>/gi)
    .map(block => ({
      serviceType: extractFirst(block, 'serviceType') ?? '',
      controlURL: extractFirst(block, 'controlURL') ?? '',
    }))
    .filter(service => service.serviceType && service.controlURL);

  return {
    udn: extractFirst(xml, 'UDN'),
    friendlyName: extractFirst(xml, 'friendlyName'),
    manufacturer: extractFirst(xml, 'manufacturer'),
    modelName: extractFirst(xml, 'modelName'),
    services,
  };
}

export function resolveControlUrl(baseLocation: string, controlUrl: string): string {
  const base = new URL(baseLocation);
  const resolved = new URL(controlUrl, base);
  if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
    throw new Error('Unsupported DLNA control URL protocol');
  }
  if (resolved.hostname !== base.hostname) {
    throw new Error('DLNA control URL must stay on the advertised device host');
  }
  return resolved.toString();
}

export function pickLanAddressForTarget(targetHost: string): string {
  const fallback = firstNonInternalIPv4();
  if (net.isIP(targetHost) !== 4) return fallback;

  const target = ipv4ToInt(targetHost);
  for (const infos of Object.values(os.networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family !== 'IPv4' || info.internal || !info.netmask) continue;
      const mask = ipv4ToInt(info.netmask);
      if ((ipv4ToInt(info.address) & mask) === (target & mask)) return info.address;
    }
  }
  return fallback;
}

function ssdpSearch(): Promise<Array<{ headers: Record<string, string>; address: string }>> {
  return new Promise(resolve => {
    const responses = new Map<string, { headers: Record<string, string>; address: string }>();
    const sockets: dgram.Socket[] = [];
    let finished = false;
    const makeSearchPacket = (st: string) => [
      'M-SEARCH * HTTP/1.1',
      `HOST: ${SSDP_ADDRESS}:${SSDP_PORT}`,
      'MAN: "ssdp:discover"',
      'MX: 1',
      `ST: ${st}`,
      '',
      '',
    ].join('\r\n');

    const finish = () => {
      if (finished) return;
      finished = true;
      for (const socket of sockets) {
        socket.removeAllListeners();
        try { socket.close(); } catch { /* already closed */ }
      }
      resolve([...responses.values()]);
    };

    const interfaces = getUsableIPv4Interfaces();
    if (interfaces.length === 0) interfaces.push({ address: '0.0.0.0', netmask: '0.0.0.0' });

    for (const iface of interfaces) {
      const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      sockets.push(socket);
      socket.on('message', (message, rinfo) => {
        const headers = parseSsdpHeaders(message.toString('utf8'));
        const location = headers.location;
        if (!location) return;
        responses.set(`${location}|${rinfo.address}`, { headers, address: rinfo.address });
      });
      socket.on('error', () => {
        socket.removeAllListeners();
        try { socket.close(); } catch { /* already closed */ }
      });
      socket.bind(0, iface.address, () => {
        socket.setBroadcast(true);
        try { socket.setMulticastInterface(iface.address); } catch { /* not supported for this adapter */ }
        for (const st of [MEDIA_RENDERER_ST, SSDP_ALL_ST]) {
          const packet = Buffer.from(makeSearchPacket(st));
          socket.send(packet, 0, packet.length, SSDP_PORT, SSDP_ADDRESS);
        }
      });
    }

    setTimeout(finish, DISCOVERY_TIMEOUT_MS);
  });
}

async function addDeviceFromSsdp(response: { headers: Record<string, string>; address: string }): Promise<void> {
  const location = response.headers.location;
  if (!isAcceptableDeviceLocation(location, response.address)) return;

  const xml = await fetchText(location);
  const parsed = parseDeviceDescription(xml);
  const avTransport = parsed.services.find(service => service.serviceType === AV_TRANSPORT_SERVICE);
  if (!avTransport) return;

  const renderingControl = parsed.services.find(service => service.serviceType === RENDERING_CONTROL_SERVICE);
  const baseUrl = new URL(location);
  const id = makeDeviceId(parsed.udn ?? location);
  devices.set(id, {
    id,
    name: parsed.friendlyName ?? response.headers.server ?? baseUrl.hostname,
    manufacturer: parsed.manufacturer,
    modelName: parsed.modelName,
    host: baseUrl.hostname,
    location,
    avTransportControlUrl: resolveControlUrl(location, avTransport.controlURL),
    renderingControlUrl: renderingControl ? resolveControlUrl(location, renderingControl.controlURL) : null,
    expiresAt: Date.now() + DEVICE_TTL_MS,
  });
}

function isAcceptableDeviceLocation(location: string, responseAddress: string): boolean {
  return getDeviceLocationRejectionReason(location, responseAddress) === null;
}

function getDeviceLocationRejectionReason(location: string, responseAddress: string): string | null {
  try {
    const url = new URL(location);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'Location is not HTTP/HTTPS';
    if (net.isIP(url.hostname) !== 4) return 'Location host is not an IPv4 literal';
    if (url.hostname !== responseAddress) return `Location host ${url.hostname} differs from response address ${responseAddress}`;
    return null;
  } catch {
    return 'Location is not a valid URL';
  }
}

async function fetchText(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`DLNA device description returned ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function soapAction(controlUrl: string, serviceType: string, action: string, args: Record<string, string>): Promise<string> {
  const body = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">',
    '<s:Body>',
    `<u:${action} xmlns:u="${serviceType}">`,
    ...Object.entries(args).map(([key, value]) => `<${key}>${escapeXml(value)}</${key}>`),
    `</u:${action}>`,
    '</s:Body>',
    '</s:Envelope>',
  ].join('');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(controlUrl, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'text/xml; charset="utf-8"',
        SOAPACTION: `"${serviceType}#${action}"`,
      },
      body,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`DLNA ${action} failed with ${res.status}: ${text.slice(0, 300)}`);
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

function buildDidlLiteMetadata(streamUrl: string, title: string, site?: string | null): string {
  return [
    '<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/">',
    '<item id="video" parentID="0" restricted="1">',
    `<dc:title>${escapeXml(title || 'Untitled')}</dc:title>`,
    site ? `<upnp:album>${escapeXml(site)}</upnp:album>` : '',
    '<upnp:class>object.item.videoItem</upnp:class>',
    `<res protocolInfo="http-get:*:video/mp4:*">${escapeXml(streamUrl)}</res>`,
    '</item>',
    '</DIDL-Lite>',
  ].join('');
}

function parseSsdpHeaders(text: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx < 1) continue;
    headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
  }
  return headers;
}

function extractFirst(xml: string, tagName: string): string | null {
  const match = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i').exec(xml);
  return match ? decodeXml(match[1].trim()) : null;
}

function extractAll(text: string, pattern: RegExp): string[] {
  return [...text.matchAll(pattern)].map(match => match[1]);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function makeDeviceId(value: string): string {
  return crypto.createHash('sha1').update(value).digest('hex').slice(0, 16);
}

function publicDevices(): CastDevice[] {
  return [...devices.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(({ id, name, manufacturer, modelName, host, location }) => ({ id, name, manufacturer, modelName, host, location }));
}

function pruneDevices(): void {
  const now = Date.now();
  for (const [id, device] of devices) {
    if (device.expiresAt <= now) devices.delete(id);
  }
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function firstNonInternalIPv4(): string {
  const lan = getUsableIPv4Interfaces()[0];
  if (lan) return lan.address;
  for (const infos of Object.values(os.networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family === 'IPv4' && !info.internal) return info.address;
    }
  }
  return '127.0.0.1';
}

function ipv4ToInt(value: string): number {
  return value.split('.').reduce((acc, part) => ((acc << 8) + Number(part)) >>> 0, 0);
}

function getUsableIPv4Interfaces(): Array<{ address: string; netmask: string }> {
  const items: Array<{ address: string; netmask: string; score: number }> = [];
  for (const infos of Object.values(os.networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family !== 'IPv4' || info.internal || !info.netmask) continue;
      if (info.address.startsWith('169.254.')) continue;
      const privateLan =
        info.address.startsWith('192.168.')
        || info.address.startsWith('10.')
        || /^172\.(1[6-9]|2\d|3[0-1])\./.test(info.address);
      items.push({ address: info.address, netmask: info.netmask, score: privateLan ? 0 : 1 });
    }
  }
  return items
    .sort((a, b) => a.score - b.score || a.address.localeCompare(b.address))
    .map(({ address, netmask }) => ({ address, netmask }));
}
