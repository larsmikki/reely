import dgram from 'node:dgram';
import os from 'node:os';

const SSDP_ADDRESS = '239.255.255.250';
const SSDP_PORT = 1900;
const SEARCH_TARGETS = [
  'urn:schemas-upnp-org:device:MediaRenderer:1',
  'ssdp:all',
];

const seen = new Set();
const sockets = [];

function parseHeader(text, name) {
  const match = new RegExp(`^${name}:\\s*(.*)$`, 'im').exec(text);
  return match?.[1]?.trim() ?? '';
}

function search(socket, st) {
  const packet = Buffer.from([
    'M-SEARCH * HTTP/1.1',
    `HOST: ${SSDP_ADDRESS}:${SSDP_PORT}`,
    'MAN: "ssdp:discover"',
    'MX: 2',
    `ST: ${st}`,
    '',
    '',
  ].join('\r\n'));
  socket.send(packet, 0, packet.length, SSDP_PORT, SSDP_ADDRESS);
}

async function inspectLocation(location) {
  if (!location) return;
  try {
    const res = await fetch(location, { signal: AbortSignal.timeout(4000) });
    const xml = await res.text();
    const name = /<friendlyName\b[^>]*>([\s\S]*?)<\/friendlyName>/i.exec(xml)?.[1]?.trim();
    const manufacturer = /<manufacturer\b[^>]*>([\s\S]*?)<\/manufacturer>/i.exec(xml)?.[1]?.trim();
    const hasAvTransport = xml.includes('urn:schemas-upnp-org:service:AVTransport:1');
    console.log(`  Description: ${res.status} ${name ? `name="${name}" ` : ''}${manufacturer ? `manufacturer="${manufacturer}" ` : ''}AVTransport=${hasAvTransport ? 'yes' : 'no'}`);
  } catch (err) {
    console.log(`  Description fetch failed: ${err.message}`);
  }
}

function onMessage(message, rinfo) {
  const text = message.toString('utf8');
  const location = parseHeader(text, 'LOCATION');
  const st = parseHeader(text, 'ST');
  const usn = parseHeader(text, 'USN');
  const key = `${location}|${st}|${usn}`;
  if (seen.has(key)) return;
  seen.add(key);

  console.log(`\nSSDP response from ${rinfo.address}`);
  console.log(`  ST: ${st || '(missing)'}`);
  console.log(`  USN: ${usn || '(missing)'}`);
  console.log(`  LOCATION: ${location || '(missing)'}`);
  void inspectLocation(location);
}

function getUsableIPv4Interfaces() {
  const items = [];
  for (const infos of Object.values(os.networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family !== 'IPv4' || info.internal || !info.netmask) continue;
      if (info.address.startsWith('169.254.')) continue;
      const privateLan =
        info.address.startsWith('192.168.')
        || info.address.startsWith('10.')
        || /^172\.(1[6-9]|2\d|3[0-1])\./.test(info.address);
      items.push({ address: info.address, score: privateLan ? 0 : 1 });
    }
  }
  return items.sort((a, b) => a.score - b.score || a.address.localeCompare(b.address));
}

const interfaces = getUsableIPv4Interfaces();
if (interfaces.length === 0) interfaces.push({ address: '0.0.0.0' });
console.log(`Searching from: ${interfaces.map(i => i.address).join(', ')}`);

for (const iface of interfaces) {
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  sockets.push(socket);
  socket.on('message', onMessage);
  socket.on('error', err => {
    console.error(`SSDP socket error on ${iface.address}: ${err.message}`);
  });
  socket.bind(0, iface.address, () => {
    socket.setBroadcast(true);
    try { socket.setMulticastInterface(iface.address); } catch {}
    for (const st of SEARCH_TARGETS) search(socket, st);
  });
}

setTimeout(() => {
  console.log(`\nFound ${seen.size} unique SSDP response(s).`);
  if (seen.size === 0) {
    console.log('No UPnP/DLNA devices answered multicast discovery from this machine.');
  }
  for (const socket of sockets) {
    try { socket.close(); } catch {}
  }
}, 6000);
