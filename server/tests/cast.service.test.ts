import { describe, expect, it } from 'vitest';
import { parseDeviceDescription, resolveControlUrl } from '../src/services/cast.service.js';

describe('parseDeviceDescription', () => {
  it('extracts renderer metadata and control URLs', () => {
    const parsed = parseDeviceDescription(`
      <root>
        <device>
          <friendlyName>Living Room TV</friendlyName>
          <manufacturer>Samsung</manufacturer>
          <modelName>Smart TV</modelName>
          <UDN>uuid:abc</UDN>
          <serviceList>
            <service>
              <serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType>
              <controlURL>/upnp/control/AVTransport1</controlURL>
            </service>
            <service>
              <serviceType>urn:schemas-upnp-org:service:RenderingControl:1</serviceType>
              <controlURL>/upnp/control/RenderingControl1</controlURL>
            </service>
          </serviceList>
        </device>
      </root>
    `);

    expect(parsed.friendlyName).toBe('Living Room TV');
    expect(parsed.manufacturer).toBe('Samsung');
    expect(parsed.modelName).toBe('Smart TV');
    expect(parsed.udn).toBe('uuid:abc');
    expect(parsed.services).toEqual([
      { serviceType: 'urn:schemas-upnp-org:service:AVTransport:1', controlURL: '/upnp/control/AVTransport1' },
      { serviceType: 'urn:schemas-upnp-org:service:RenderingControl:1', controlURL: '/upnp/control/RenderingControl1' },
    ]);
  });
});

describe('resolveControlUrl', () => {
  it('resolves relative control URLs against the device description URL', () => {
    expect(resolveControlUrl('http://192.168.1.50:8000/root.xml', '/upnp/control')).toBe('http://192.168.1.50:8000/upnp/control');
  });

  it('rejects control URLs that point away from the advertised host', () => {
    expect(() => resolveControlUrl('http://192.168.1.50:8000/root.xml', 'http://192.168.1.51/control')).toThrow(/advertised device host/);
  });
});
