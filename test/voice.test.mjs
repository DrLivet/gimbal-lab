// Run: node test/voice.test.mjs
import assert from 'node:assert/strict';
import { parseCommand, afterWakeWord } from '../src/voice.js';

const c = (t) => parseCommand(t)?.cmd ?? null;
assert.equal(c('Follow me'), 'follow-on');
assert.equal(c('okay stop following'), 'follow-off');
assert.equal(c('stay there'), 'follow-off');
assert.equal(c('recenter'), 'recenter');
assert.equal(c('re-centre please'), 'recenter');
assert.equal(c('pan left'), 'left');
assert.equal(c('look up'), 'up');
assert.equal(c('start recording'), 'record-start');
assert.equal(c('stop recording'), 'record-stop');
assert.equal(c('cut'), 'record-stop');
assert.equal(c('camera two'), 'camera-2');
assert.equal(c('camera 1'), 'camera-1');
assert.equal(c('frame me on the left'), 'frame-left');
assert.equal(c('start the script'), 'prompter-play');
assert.equal(c('pause script'), 'prompter-pause');
assert.equal(c('a little faster'), 'faster');
assert.deepEqual(parseCommand('play move reveal'), { cmd: 'play-move', arg: 'reveal' });
assert.equal(c('hello everyone welcome to the stream'), null);
assert.equal(afterWakeWord("that's right everyone", 'gimbal'), null);
assert.equal(afterWakeWord('ok gimbal follow me', 'gimbal'), 'follow me');
assert.equal(afterWakeWord('gamble camera two', 'gimbal'), 'camera two');
assert.equal(afterWakeWord('pan left', ''), 'pan left');
console.log('voice: all tests passed');
