'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const rimraf = require('rimraf');
const loaderUtils = require('loader-utils');
const execFile = require('child_process').execFile;

const exe_ext = process.platform === 'win32' ? '.exe' : '';

const grpcToolsDir = path.join(path.dirname(require.resolve('grpc-tools')), 'bin');
const protoc = path.join(grpcToolsDir, 'protoc' + exe_ext);
const protocGrpcPlugin = path.join(grpcToolsDir, 'grpc_node_plugin' + exe_ext);

const tmpDir = path.join(os.tmpdir(), `grpc-loader-`);

function noop() {}

function getGeneratedFile(srcPath, dir, cb) {
  const filePath = path.basename(srcPath).replace(/\.[^/.]+$/, '');
  const protocFilePath = path.join(dir, `${filePath}_pb.js`);
  const grpcFilePath = path.join(dir, `${filePath}_grpc_pb.js`);

  return fs.readFile(grpcFilePath, 'utf8', (err, data) => {
    if (err) return cb(err);

    return cb(null, protocFilePath, grpcFilePath, data);
  });
}

function createTmpDir(cb) {
  return fs.mkdtemp(tmpDir, cb);
}

function removeTmpDir(dir, cb) {
  return rimraf(dir, cb);
}

function generateOutput(protocFilePath, grpcFilePath) {
  return `
      exports.services = require('!!${grpcFilePath}');
      exports.messages = require('!!${protocFilePath}');
  `;
}

function processProto(dir, cb) {
  execFile(
    protoc, [
      `--proto_path=${path.dirname(this.resourcePath)}`,
      `--js_out=import_style=commonjs,binary:${dir}`,
      `--grpc_out=${dir}`,
      `--plugin=protoc-gen-grpc=${protocGrpcPlugin}`,
      this.resourcePath,
    ], {
      encoding: 'utf8'
    },
    (error, stdout, stderr) => {
      if (error) return removeTmpDir(dir, () => cb(error));
      if (stderr) this.emitError(stderr);

      getGeneratedFile(this.resourcePath, dir, (error, protocFilePath, grpcFilePath, value) => {
        if (error) return removeTmpDir(dir, () => cb(error));

        const protocFileName = path.basename(protocFilePath, '.js');

        // don't process the result
        const grpcFileContent = value.replace(`require('./${protocFileName}.js');`, `require('!!${protocFilePath.replace(/\\/g, '\/')}');`);

        fs.writeFile(grpcFilePath, grpcFileContent, (error) => {
          if (error) return removeTmpDir(dir, () => cb(error));

          const result = generateOutput(protocFilePath, grpcFilePath);
          // removeTmpDir(dir, noop);
          cb(null, result);
        });
      });
    });
}

module.exports = function(source) {
  if (this.cacheable) this.cacheable();

  const callback = this.async();

  createTmpDir((error, dir) => {
    if (error) return callback(error);

    processProto.call(this, dir, callback);
  });
};
