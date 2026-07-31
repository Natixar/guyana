// Encodage base58btc préfixé « z », tel qu'attendu par les preuves
// Data Integrity du W3C pour les valeurs de signature et les clés.

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58btcEncode(bytes) {
  if (bytes.length === 0) return "";
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) { digits.push(carry % 58); carry = (carry / 58) | 0; }
  }
  // Chaque octet nul de tête devient un « 1 ».
  let out = "";
  for (let i = 0; i < bytes.length && bytes[i] === 0; i++) out += ALPHABET[0];
  for (let i = digits.length - 1; i >= 0; i--) out += ALPHABET[digits[i]];
  return out;
}

/** Préfixe multibase « z » = base58btc. */
export const multibase58 = (bytes) => "z" + base58btcEncode(bytes);

const INDEX = Object.fromEntries([...ALPHABET].map((c, i) => [c, i]));

export function base58btcDecode(str) {
  const bytes = [0];
  for (const ch of str) {
    const v = INDEX[ch];
    if (v === undefined) throw new Error("invalid base58 character: " + ch);
    let carry = v;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  // Chaque « 1 » de tête est un octet nul.
  for (let i = 0; i < str.length && str[i] === ALPHABET[0]; i++) bytes.push(0);
  return new Uint8Array(bytes.reverse());
}

/** Décode une valeur multibase « z… ». */
export function multibase58Decode(str) {
  if (!str?.startsWith("z")) throw new Error("not a base58btc multibase value");
  return base58btcDecode(str.slice(1));
}
