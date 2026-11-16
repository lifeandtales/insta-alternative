// Local media controls currently require numeric IDs. Use the negative range for cloud imports.
export function remoteMediaId(key) {
    let hash = 14695981039346656037n;
    for (const character of key) hash = BigInt.asUintN(64, (hash ^ BigInt(character.codePointAt(0))) * 1099511628211n);
    return -1 - Number(hash & ((1n << 52n) - 1n));
}
