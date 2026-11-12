import { isPrivateIp } from './rules.service';

describe('webhook SSRF guard', () => {
  it('blocks private and loopback addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.1.5', '172.20.0.1', '169.254.169.254', '::1', 'fd00::1']) {
      expect(isPrivateIp(ip)).toBe(true);
    }
  });
  it('allows public addresses', () => {
    for (const ip of ['8.8.8.8', '104.16.1.1', '2606:4700::1111']) expect(isPrivateIp(ip)).toBe(false);
  });
});
