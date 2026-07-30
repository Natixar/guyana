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
