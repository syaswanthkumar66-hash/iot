// Pure JS SHA-256 and HMAC-SHA256 Implementation
// Highly compatible with React Native, Expo, and Web JS bundles.

const sha256 = (m) => {
    const K = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ];

    const H = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
    ];

    let words = [];
    let l = m.length * 8;
    for (let i = 0; i < l; i += 8) {
        words[i >> 5] |= (m.charCodeAt(i / 8) & 0xff) << (24 - (i % 32));
    }
    words[l >> 5] |= 0x80 << (24 - (l % 32));
    words[(((l + 64) >> 9) << 4) + 15] = l;

    for (let i = 0; i < words.length; i += 16) {
        let w = words.slice(i, i + 16);
        let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];

        for (let j = 0; j < 64; j++) {
            if (j >= 16) {
                let s0 = ((w[j - 15] >>> 7) | (w[j - 15] << 25)) ^ ((w[j - 15] >>> 18) | (w[j - 15] << 14)) ^ (w[j - 15] >>> 3);
                let s1 = ((w[j - 2] >>> 17) | (w[j - 2] << 15)) ^ ((w[j - 2] >>> 19) | (w[j - 2] << 13)) ^ (w[j - 2] >>> 10);
                w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0;
            }

            let S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
            let ch = (e & f) ^ (~e & g);
            let temp1 = (h + S1 + ch + K[j] + (w[j] || 0)) | 0;
            let S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let temp2 = (S0 + maj) | 0;

            h = g;
            g = f;
            f = e;
            e = (d + temp1) | 0;
            d = c;
            c = b;
            b = a;
            a = (temp1 + temp2) | 0;
        }

        H[0] = (H[0] + a) | 0;
        H[1] = (H[1] + b) | 0;
        H[2] = (H[2] + c) | 0;
        H[3] = (H[3] + d) | 0;
        H[4] = (H[4] + e) | 0;
        H[5] = (H[5] + f) | 0;
        H[6] = (H[6] + g) | 0;
        H[7] = (H[7] + h) | 0;
    }

    let hex = "";
    for (let i = 0; i < 8; i++) {
        let s = (H[i] >>> 0).toString(16);
        while (s.length < 8) s = "0" + s;
        hex += s;
    }
    return hex;
};

export function hmac_sha256(key, message) {
    let key_str = key;
    if (key_str.length > 64) {
        let hex = sha256(key_str);
        key_str = "";
        for (let i = 0; i < hex.length; i += 2) {
            key_str += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
        }
    }
    while (key_str.length < 64) {
        key_str += "\0";
    }

    let ipad = "";
    let opad = "";
    for (let i = 0; i < 64; i++) {
        ipad += String.fromCharCode(key_str.charCodeAt(i) ^ 0x36);
        opad += String.fromCharCode(key_str.charCodeAt(i) ^ 0x5c);
    }

    let inner_hex = sha256(ipad + message);
    let inner_msg = "";
    for (let i = 0; i < inner_hex.length; i += 2) {
        inner_msg += String.fromCharCode(parseInt(inner_hex.substr(i, 2), 16));
    }

    return sha256(opad + inner_msg);
}
