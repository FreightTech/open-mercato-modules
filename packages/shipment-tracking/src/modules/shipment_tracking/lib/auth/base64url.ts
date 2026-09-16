export function base64UrlEncode(data: string | Buffer): string {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data)
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}
