/**
 * pilidown - Unit tests for qrcode util (mocked qrcode module)
 * Original: tests are original to pilidown.
 */

jest.mock('qrcode', () => ({ toString: jest.fn() }));

import * as QRCode from 'qrcode';
import { printQrCodeInTerminal, getQrCodeString } from '../../src/utils/qrcode';

const toStringMock = QRCode.toString as unknown as jest.MockedFunction<
  (text: string, options?: { type: 'terminal' }) => Promise<string>
>;
let writeSpy: jest.SpyInstance;

beforeEach(() => {
  toStringMock.mockReset();
  writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

afterEach(() => {
  writeSpy.mockRestore();
  jest.restoreAllMocks();
});

describe('printQrCodeInTerminal', () => {
  test('calls qrcode.toString with type=terminal and writes result to stdout', async () => {
    toStringMock.mockResolvedValueOnce('██ ███ ███\n█  ██  ██\n██ ███ ███');
    await printQrCodeInTerminal('https://example.com/login');
    expect(toStringMock).toHaveBeenCalledTimes(1);
    const [textArg, optsArg] = toStringMock.mock.calls[0];
    expect(textArg).toBe('https://example.com/login');
    expect(optsArg).toEqual({ type: 'terminal' });
    // write was called with the QR text + newline
    const written = writeSpy.mock.calls.map(c => c[0]).join('');
    expect(written).toContain('██ ███ ███');
    expect(written.endsWith('\n')).toBe(true);
  });

  test('propagates errors from qrcode.toString', async () => {
    toStringMock.mockRejectedValueOnce(new Error('too long'));
    await expect(printQrCodeInTerminal('x')).rejects.toThrow('too long');
  });
});

describe('getQrCodeString', () => {
  test('returns the string from qrcode.toString without writing to stdout', async () => {
    toStringMock.mockResolvedValueOnce('█░█░█');
    const s = await getQrCodeString('https://example.com');
    expect(s).toBe('█░█░█');
    expect(toStringMock).toHaveBeenCalledWith('https://example.com', { type: 'terminal' });
    expect(writeSpy).not.toHaveBeenCalled();
  });

  test('propagates errors from qrcode.toString', async () => {
    toStringMock.mockRejectedValueOnce(new Error('encode failed'));
    await expect(getQrCodeString('x')).rejects.toThrow('encode failed');
  });
});
