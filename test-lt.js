const { LTEncoder, LTDecoder } = require('luby-transform');

const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
const encoder = new LTEncoder(data, 2); // chunk size 2

const blocks = [];
for (let i = 0; i < 20; i++) {
    blocks.push(encoder.getBlock());
}

const decoder = new LTDecoder(10, 2);
for (const block of blocks) {
    decoder.addBlock(block);
    console.log('Decoded:', decoder.isDecoded());
    if (decoder.isDecoded()) {
        console.log('Result:', decoder.getDecoded());
        break;
    }
}
