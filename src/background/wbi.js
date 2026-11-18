const mixinOrder = [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52];
const shifts = [7,12,17,22,5,9,14,20,4,11,16,23,6,10,15,21];
const constants = Array.from({ length: 64 }, (_, index) => Math.floor(Math.abs(Math.sin(index + 1)) * 4294967296) >>> 0);

/** WBI 所需的 UTF-8 MD5；不使用 eval 或远程脚本。 */
export function md5(value) {
  const bytes = new TextEncoder().encode(value);
  const buffer = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
  buffer.set(bytes);
  buffer[bytes.length] = 128;
  const view = new DataView(buffer.buffer);
  view.setUint32(buffer.length - 8, (bytes.length * 8) >>> 0, true);
  view.setUint32(buffer.length - 4, Math.floor(bytes.length / 536870912), true);
  const state = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
  for (let block = 0; block < buffer.length; block += 64) {
    let [first, second, third, fourth] = state;
    for (let round = 0; round < 64; round++) {
      const section = Math.floor(round / 16);
      const mixed = section === 0 ? (second & third) | (~second & fourth) :
        section === 1 ? (fourth & second) | (~fourth & third) :
          section === 2 ? second ^ third ^ fourth : third ^ (second | ~fourth);
      const word = section === 0 ? round : section === 1 ? (5 * round + 1) % 16 : section === 2 ? (3 * round + 5) % 16 : (7 * round) % 16;
      const sum = (first + mixed + constants[round] + view.getUint32(block + word * 4, true)) | 0;
      const shift = shifts[section * 4 + round % 4];
      const next = (second + ((sum << shift) | (sum >>> (32 - shift)))) | 0;
      first = fourth; fourth = third; third = second; second = next;
    }
    [first, second, third, fourth].forEach((part, index) => { state[index] = (state[index] + part) | 0; });
  }
  return state.map(part => [0, 8, 16, 24].map(shift => ((part >>> shift) & 255).toString(16).padStart(2, '0')).join('')).join('');
}

export function signWbi(params, imgKey, subKey, timestamp = Math.floor(Date.now() / 1000)) {
  const source = imgKey + subKey;
  const mixin = mixinOrder.map(index => source[index] || '').join('').slice(0, 32);
  if (mixin.length !== 32) throw new Error('WBI 密钥无效');
  const signed = { ...params, wts: timestamp };
  const query = Object.keys(signed).sort().map(key => `${encodeURIComponent(key)}=${encodeURIComponent(String(signed[key]).replace(/[!'()*]/g, ''))}`).join('&');
  return `${query}&w_rid=${md5(query + mixin)}`;
}
