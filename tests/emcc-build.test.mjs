// The firmware link refuses a module that names a folder of the machine that built it (emscripten writes the .data file's
// path as given to -o; the link therefore runs in the output folder with a relative -o, and checks the result).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { localPathsIn } from '../tools/emcc-build.mjs';

test('a module naming its build folder is caught; a relative .data name is fine', () => {
  const dir = '/Users/someone/work/build/brufik';
  assert.deepEqual(localPathsIn(`var PACKAGE_NAME = 'brufik.data'; var REMOTE_PACKAGE_BASE = 'brufik.data';`, [dir]), []);
  assert.deepEqual(localPathsIn(`var PACKAGE_NAME = '${dir}/brufik.data';`, [dir, '/nowhere/else']), [dir]);
  assert.deepEqual(localPathsIn(`import('/x.mjs')`, ['/', '/Users']), [], 'a root or one-level folder is too short to tell');
});
